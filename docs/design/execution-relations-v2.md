# 실행 관계 분석 v2 API와 구현 범위

2026-11-12. [확장 설계 E-01~E-11](execution-relations-extension.md)의 독립 분석·조회 계층을 구현했습니다. **기존 중간언어, 자료구조 추론기, 시각화는 변경하거나 자동 연결하지 않았습니다.** 기존 v1이 기본이며 확장은 명시적으로 선택합니다.

## 호출과 저장

```js
import {
  inferExecutionRelationsAsync,
  createExecutionWorkQuery,
  createExecutionRelationQuery,
  validateExecutionRelations,
} from './scripts/execution-relations/index.mjs';

const options = {outputSchemaVersion: 2};
const relations = await inferExecutionRelationsAsync(plan, trace, options);
validateExecutionRelations(plan, trace, relations);
const query = createExecutionWorkQuery(plan, trace, relations, {schemaVersion: 2});
const id = trace.events.at(-1)?.eventId ?? null;
const before = id === null ? query.at(null) : query.before(id);
const after = query.at(id);
// 펼쳐 볼 대상은 원본에 있는 값 관찰 참조입니다. 실제 메모리 값은 반환하지 않습니다.
const origins = id === null ? null : query.origins({executionId: id}, {atExecutionId: id});
const history = createExecutionRelationQuery(plan, trace, relations).at(id);
```

위 경로는 기존에 생성한 plan/trace를 읽습니다. C 컴파일·실행이나 자료구조 추론을 호출하지 않습니다. `at`은 사건 이후, `before`는 직전 경계입니다. 원래 재생기는 자신의 시간선으로 before/after 값을 표현하며, 분석기가 시각화의 값 반영 시점을 바꾸지 않습니다. `history`는 성립한 역사적 관계 목록이며 현재 활성 관계만의 목록이 아닙니다.

```powershell
node scripts/infer-execution-relations.mjs test-results/c-model --schema-version 2
```

v2는 `execution-relations-v2.json`에 저장합니다. 기존 `plan.json`, `trace.json`, `execution-relations.json`은 그대로 둡니다. `--schema-version`을 생략하면 종전 v1 경로입니다. 보조 입력은 `--structure-inference`, `--compiler-facts`, `--observation-evidence`로 지정합니다.

## 실제 구현

2026-11-12: [주소 출처 계약](address-origin-contract.md)에 따라 입력 안의 접힌 주소 관찰을 같은 사건의 출처 노드로 연결합니다. 복귀에 보존된 호출 인자를 반환값으로 다시 분석하지 않습니다. 불완전한 주소 근거는 계속 보고하며, 단순 경고 억제로 처리하지 않습니다.

| 독립 모듈 (`scripts/execution-relations/v2/`) | 책임 |
| --- | --- |
| `common.mjs` | 읽기 전용 근거·정체성·내용 지문·예산·결정적 관계 ID. 여러 정규 명령이 공유하는 내부 관찰 ID를 실행 ID와 시점으로 구분 |
| `accesses.mjs`, `calls.mjs` | 실제 접근/라이브러리 효과·참조·실패 시도, 실제 호출과 인자/반환의 연결 |
| `provenance.mjs` | 역할별 공유 DAG, 부분 범위 생산자 색인, 명시적 초기화 관찰, 현재 피연산자와 역사적 기원 구별 |
| `regions.mjs` | 반복형 호출 트리, 직접/subtree 접근 집합, 종료 요약과 관련 호출 영역 비교 |
| `bounds.mjs` | 구조화된 컴파일 근거가 있는 아핀 영역. 실제 접근과 후보 영역 분리, 덮어쓰기/호출/수명 종료에 따른 무효화 |
| `work.mjs` | 표현식/호출/반복 문맥, 값 전달 사슬·다중 입력·분기 전달·관찰 버전 순환, 구조 요소와 저장 범위 대응 |
| `result.mjs` | v2 형식·참조·성립 시점·범위·출처 순환/변환·복사 경로·스냅샷 검사 |
| `engine.mjs`, `query.mjs` | 선행 기능을 선언한 분석 단계와 실패 격리, 색인/캐시를 이용한 시점·출처 조회 |

결과는 `{schemaVersion, scope, snapshot, status, capabilities, relations, changes, provenance, coverage, diagnostics}`입니다. 값·객체 장면·좌표·재생 지시를 저장하지 않습니다. `completed`는 등록된 분석 단계의 완료이며 모든 출처·의도·C 문법의 완전성을 뜻하지 않습니다. 각 노드/조회의 `unresolved`, 기능별 capability와 coverage를 함께 확인합니다.

복사·계산·정수 비트 보존 cast·숫자 변환·인자/반환·선택의 판단 근거·주소/참조·범위 효과를 구분합니다. 원본 숫자가 같다는 이유로 출처를 연결하지 않습니다. `rootReadExecutionId`는 전체 폭의 identity 전달을 따라 확인한 관찰 기준이며, 더 오래된 모든 기원은 지연 `origins` 조회가 담당합니다. 부분 조각은 전체 원소 복사로 승격하지 않습니다.

`transfer-dependency`, `fan-out-transfer`, `multi-source-transfer`, `transfer-cycle`은 실제 복사/출처 관계의 조합입니다. 다중 원본 관계는 관측 prefix에서 누적되며, 순환 요약은 각 원본 버전이 해당 위치의 덮어쓰기 이전에 읽혔는지 확인합니다. 이것이 정렬·병합·깊은 복사 등 알고리즘의 의도/정확성 판정은 아닙니다.

## 선택적 컴파일 근거

`compilerFacts`는 `schemaVersion:1`, 같은 `scope.programId`를 가진 구조화된 메타데이터입니다. `scope.runId`와 canonical 소스 스냅샷의 `sourceDigest`를 제공하면 일치 여부도 검사합니다. 원문이나 AST/LLVM 텍스트를 분석기에 전달해 새로 파싱하는 입력은 없습니다.

아래 ID는 형식 설명용이며 실제 plan/trace의 ID로 대응되어야 합니다.

```js
const compilerFacts = {
  schemaVersion: 1,
  scope: {programId: plan.programId},
  expressionOwners: [{instructionId: 'iAccess', nodeId: 'sourceExpressionNode'}],
  regions: [{
    id: 'loopRegion', kind: 'loop', functionId: 'functionId',
    entryInstructionIds: ['iBodyEntry'],
    exitInstructionIds: ['iLoopExit'],
    memberInstructionIds: ['iBodyEntry', 'iAccess', 'iWrite'],
  }],
  domains: [{
    id: 'domain', proofKind: 'affine-loop', functionId: 'functionId',
    entryInstructionIds: ['iLoopEntry'], accessInstructionIds: ['iAccess'],
    sourceNodeIds: ['sourceExpressionNode'],
    base: {parameterIndex: 0}, lower: {parameterIndex: 1}, upper: {parameterIndex: 2},
    step: '1', comparison: '<', elementSizeBytes: 4,
    indexType: {sizeBits: 32, signedness: 'signed'},
  }],
};
```

영역 근거 ID는 기존 컴파일 결과의 실제 노드/명령에 연결해야 합니다. `entryInstructionIds`는 루프의 실제 동적 진입, `regions`의 body entry는 반복 시작을 뜻합니다. for/while/do 모두 같은 몸체 진입 규칙을 사용하며, 이름이나 `syntax` 문자열로 반복을 추측하지 않습니다. 본문이 한 번도 실행되지 않으면 가상 반복을 만들지 않습니다.

스칼라/포인터 바인딩은 `{parameterIndex}` 또는 `{instructionId}`의 현재 관찰을 사용합니다. 상수는 `{literal:'0', nodeId:'실제 노드'}`입니다. `indexScale`, `indexOffset`으로 입증된 아핀 오프셋을 지정할 수 있습니다. 양/음의 단조 step과 `<`, `<=`, `>`, `>=`를 지원하며, 정수 wrap 가능성·객체 경계·불명확한 입력은 확정하지 않습니다. 큰 stride는 `pattern`으로 유지합니다.

기준·경계 슬롯에 대한 부분/전체 쓰기는 기존 후보를 무효화합니다. 재진입 때 이전 초기 인자를 재사용하지 않고 해당 슬롯의 최신 완전 관찰을 확인합니다. 영향이 불명확한 호출 이후에는 재관찰을 요구합니다. `safeCallInstructionIds`는 외부 컴파일 효과 분석이 안전성을 확인한 호출에만 지정합니다.

컴파일 메타데이터의 기본 자동 수집은 상위 [화면 연결 경로](work-context-view.md)에 추가했습니다. 분석기 자체는 컴파일러를 호출하지 않습니다. 제어 영역은 `entryEdges/exitEdges: [{instructionId,selected}]`의 실제 컴파일 분기도 받습니다. 근거가 없으면 해당 기능은 unavailable이며 실제 접근·출처·호출 분석은 계속합니다. 현재 plan이 모든 루프의 SSA/경계 정보를 이미 제공한다고 가정하지 않습니다.

## 보조 관찰과 자료구조 대응

- `observationEvidence`: `{schemaVersion:1, scope:{programId,runId}, bindings:[{observationId,executionId,order?,inputs?}]}`. 실제 정규 사건과의 대응을 검사하며, 입력 연결이 부족한 경우를 보완합니다. 새 IR 사건은 만들지 않습니다. 실행 ID가 없는 보조 관찰은 받지 않습니다.
- 정규 사건 ID와 내부 관찰 ID를 함께 받으면 그 정규 사건의 관찰인지 확인합니다. 같은 내부 관찰이 여러 정규 명령에 사용된 경우 여러 소유자를 보존하고 미래/모호한 대응을 임의로 선택하지 않습니다.
- `structureInference.storageBindings`: `{id?,structureId,elementId,objectId,offset,size,availableAtExecutionId,invalidatedAtExecutionId?}` 목록. 원래 저장소·성립 시점·부분 범위를 유지합니다. 중첩/대안 보기를 모두 유지합니다.
- 현재 추론 결과의 `structures[].nodes[].range + discoveredAtExecutionId`도 읽습니다. 선언된 C 배열은 컴파일러가 보장한 전체 범위에서 원소 대응을 제공합니다. 시점 근거가 없는 동적 후보를 최종 배열 길이로 과거에 투영하지 않습니다.
- 알 수 없는 자료구조 출력 형식은 저장 대응 capability를 unavailable로 남깁니다. 추론기 구현을 가져와 실행하거나 새 후보를 만들지 않습니다. 추가 표현은 같은 시간·저장 대응 계약의 어댑터로 확장할 수 있습니다.

## 비용과 남은 범위

기본 예산은 `maxEvents:1_000_000`, `maxRelations:500_000`, `maxProvenanceEdges:2_000_000`, `maxOriginDepth:256`, `maxQueryItems:20_000`, `maxDomainElements:10_000`, `timeMs:25_000`입니다. 임시 기본값이며 대규모 운영 보장을 뜻하지 않습니다. 기존 Async Worker의 별도 하드 시간 제한도 유지합니다.

저장 생산자는 정렬된 비중첩 범위에서 겹치는 부분을 조회/교체합니다. 조회는 사건·호출·객체·범위·작업 문맥별 색인과 요청한 scope의 prefix 캐시를 사용합니다. 역방향 이동은 해당 캐시만 다시 계산합니다. 형제 호출은 저장소별 인접 관계만 비교하며 전체 호출 쌍을 비교하지 않습니다.

관계/간선/조회 제한은 partial·coverage·unresolved로 알립니다. 출력 한도로 접근 사실이 빠진 경우 조회 영역을 complete로 반환하지 않습니다. 모든 과거 출처를 현재 피연산자로 펼치지 않습니다. `history`는 기존 전체 관계 조회 의미를 유지하므로 반환량이 클 수 있고, 일반 재생에는 `at`과 제한된 `origins`를 사용합니다.

미구현 범위는 새 trace append의 증분 분석 세션, 알려지지 않은 추론 결과 형식의 어댑터, 임의의 비선형 경계 증명, 알고리즘 의도/정답 판정, 일반 자동 배치입니다. 기본 컴파일 근거 수집·입력 세션의 스냅샷별 연결·추가 보기는 [현재 작업 연결 보기](work-context-view.md)에 구현했습니다. 분석기 자체는 고정 스냅샷의 독립 분석/조회입니다.

검증의 실제 범위와 설계 대응은 [v2 검증](../validation/execution-relations-v2.md)을 따릅니다. API 검사 성공은 화면 가독성 검증을 뜻하지 않습니다.

## 공유 저장소와 입력 스냅샷 (2026-11-13)

접근의 원본 사건·이름·수명은 실행 기록에 남깁니다. 물리적 쓰기 출처는 컴파일러 storageAlias 사슬의 루트와 누적 offset으로 비교하여 같은 반환 저장소의 생산자를 놓치지 않습니다. 수명 확인은 접근한 소스 객체에 수행합니다. 새 할당 세대와 재사용 주소는 별개입니다.

입력 다이제스트는 분석 컨텍스트가 소유한 동결 복사본당 한 번 계산합니다. 반환한 다이제스트 표를 변경해도 캐시가 변하지 않으며 새 컨텍스트·수정된 입력은 다시 검증합니다. 해시 알고리즘과 정규화 형식은 유지합니다.
