# 중간언어 생성 모델과 자료구조 추론 모델의 분리

2026-11-11. 추론은 생성된 실행 기록의 읽기 전용 소비자입니다. 추론 없이도 컴파일·실행·중간언어 저장이 완료됩니다.

## 경계

| 위치 | 담당 |
| --- | --- |
| `scripts/model/` | AST·LLVM 연결, 계측, SPACE·READ·CALC·WRITE·FLOW와 오류, 값·참조·객체·프레임 수명, 중간언어 검증 |
| `scripts/inference/` | 저장 관계·논리 순서·자료구조 후보·세부 종류·추천·사용자 지정 정책, 추론 결과 검증 |
| `scripts/execution-relations/` | 호출·관측 구간·복사 관계 판정과 현재 사건의 작업 문맥 조회. 실행·화면에 자동 연결하지 않음 |
| `scripts/shared/` | 어느 모델도 호출하지 않는 JSON 저장·그래프 위상 유틸리티 |
| `scripts/pipeline/` | 필요할 때만 두 공개 API를 차례로 호출하는 상위 실행 경로 |

생성과 추론 사이에는 서로의 구현을 가져오는 의존성이 없습니다. 추론기는 C 소스나 컴파일러를 다시 실행하지 않습니다. AST·LLVM에서 확보된 정보는 생성 모델의 `plan`에 있는 표현식·타입·선언·소스 위치와 관측 출처를 통해 전달합니다.

관찰기는 실제 객체·참조·타입 보기를 기록합니다. 관찰기에서 하던 레코드 참조 그래프 묶기·위상 판정도 추론기로 옮겼습니다. 원본 `trace.structures`는 스키마 호환을 위해 빈 배열로 남고, 원본 `plan`에는 `structureBindings`를 추가하지 않습니다.

## 기본 관계와 조건 조합

힙·대표 관계·구간 집계의 범위는 [공통 추론 계약](priority-partition-range-inference.md)을 따릅니다. `queryDisjointSet(candidate, trace, options)`와 `queryRangeAggregate(candidate, trace, options)`는 별도 추론 후보의 시점별 상태를 반환하며 원본 실행을 변경하지 않습니다.

추론 내부에서도 저장 표현 어댑터와 자료구조 조건을 분리합니다. `queryStructureRelations`는 현재 논리적 관계를, `queryStructureConditions`는 선택한 관계에 대한 조건과 근거를 반환합니다. `evaluateStructureConditions`와 `STRUCTURE_CONDITIONS`는 공통 관계에 적용하는 순수 검사와 의존성 목록입니다.

기존 BST 추론도 같은 관계 표현·키 순서 검사기를 사용합니다. 색·저장 높이는 명시적 역할 연결을 지원합니다. 실제 연산으로 확인된 높이·rank·크기·색 후보는 별도 관리 역할로 제공하며, 높이는 유일한 후보일 때 자동 연결하고 사용자 지정이 우선합니다. 색의 의미는 자동 확정하지 않습니다. 세부 계약은 [기본 관계와 조건의 조합](structure-composition.md)과 [확장 관계 EXT-03](structure-extensions.md#ext-03-관리-역할)을 따릅니다. 생성 모델과의 분리 경계는 바뀌지 않습니다.

## API

그래프 인접 관계·보조 상태·원형 큐·COPY 기반 인덱스 관계의 추가 구현 계약은 [그래프와 작업 저장소](graph-worklist-relations.md)에 있습니다. 해당 기능도 원본 실행 기록을 변경하지 않는 별도 추론입니다.

```js
import {traceModel} from './scripts/model/index.mjs';
import {inferStructuresAsync, createInferenceView} from './scripts/inference/index.mjs';

const execution = await traceModel(source, {includeObservations: true});
const inference = await inferStructuresAsync(execution.plan, execution.trace, {
  observationPlan: execution.observations?.plan,
  observedTrace: execution.observations?.trace,
  timeoutMs: 25000,
});

// 기존 구조 조회 API에 필요한 별도 객체. execution은 변경하지 않습니다.
const view = createInferenceView(execution, inference);
```

`inferStructures`는 같은 처리를 동기적으로 수행합니다. 앱·서버에서는 독립 Worker와 시간 제한을 가진 `inferStructuresAsync`를 사용합니다. 입력을 복제한 읽기 전용 스냅샷에서 분석하므로 호출자가 가진 객체를 수정하거나 동결하지 않습니다.

추론 결과는 `{schemaVersion, scope, status, structures, bindings, coverage?, diagnostics}`입니다. `scope`는 프로그램·실행 식별자이며, 다른 실행의 결과나 보조 관찰 기록을 섞으면 거부합니다. 식별자가 없는 기존 합성 검사 입력은 계속 허용합니다. 원본 기록이 수정된 별도 실행을 같은 식별자로 위장하는 것까지 검증하는 내용 해시는 아닙니다.

`structures`와 `bindings`는 부가 데이터입니다. 추론 실패·시간 초과는 이 결과의 진단에만 남으며 C 실행 상태, 사건 수·순서, 값, 참조, 객체 생성·소멸을 변경하지 않습니다. 컴파일 실패 등으로 계획이나 실행 기록이 없으면 추론은 `skipped`입니다. 추론 미실행은 후보가 없다는 판정과 다릅니다.

`createInferenceView`는 새 최상위 객체를 만들고 추론 결과를 연결합니다. 중간언어 사건 자체는 복사하지 않고 공유하므로 조회용으로 사용합니다. 추론이 실패해도 원본 기록은 그대로 보유할 수 있습니다.

두 단계를 연속 실행하려면 `scripts/pipeline/trace-with-inference.mjs`의 `traceWithInference(source, options)`를 사용합니다. 반환값은 원본 생성 결과에 독립적인 `inference` 속성을 붙인 형태이며, `plan`·`trace`에 자동 투영하지 않습니다. `timeoutMs`와 `inferenceTimeoutMs`는 각각 별도 예산입니다.

## 이력과 근거 한도

동기·Worker API 모두 `limits: {maxStates, maxOriginDepth, maxDependencyNodes}`를 받습니다. 기본값은 각각 2048, 64, 8192이며 양의 정수만 허용합니다. `maxStates`는 후보별 출력 상태 수의 상한이고, 계열 내부의 더 작은 한도는 그대로 유효합니다. 중간 분석 전체의 메모리 상한을 뜻하지 않으며 Worker 시간 제한과 별개입니다.

출력 보관을 위해 후속 분석의 입력을 먼저 잘라내지 않습니다. 판정에 필요한 근거 체크포인트는 별도 한도 안에서 보관하고 표시 상태 조회에 사용하지 않습니다. 상태·구성원·출처 탐색 한도에 걸리면 `status: partial`과 `structure-inference-limit` 진단을 제공합니다. 진단에는 해당 단계 또는 후보, 자원 종류, 가능한 경우 한도/생략 수/최초 사건이 포함됩니다. 관측 근거가 원래 없는 경우와 구별하며 C 실행 상태는 그대로 유지합니다.

공통 원인별 구현과 한도 경계·실제 소비부 검사는 [한도 및 통합 검증 기록](../validation/inference-limits-integration-2026-11-12.md)에 정리합니다.

## 저장된 기록에서 추론

독립 추론 결과의 `storageBindings`는 구조/원소 식별자, 실제 objectId·offset·size, 관측 시작 사건, 무효화 사건을 제공합니다. 상태 이력에서 같은 대응만 병합하며, 이탈 후 재진입·공유·해제를 구분합니다. 소비자는 조회 사건이 시작 이상·무효화 미만인지 확인해야 합니다. 원본 중간언어와 실행 관계 구현은 수정하지 않습니다.

큐의 관측된 원소 순서도 실제 배열 원소 범위에 대응합니다. 생략 구간 시작에서 대응을 닫고, 최신 상태에서 다시 관측한 대응만 엽니다. 늦게 관측한 구조 종료가 이미 끝난 객체 수명을 연장하지 않습니다. 실제 추론 결과를 실행 관계 v2의 `structureInference` 입력으로 전달하는 검사를 완료했습니다. UI 적용을 뜻하지 않습니다.

```sh
node scripts/trace-model.mjs 코드.c --with-observations --out-dir test-results/my-code
node scripts/infer-structures.mjs test-results/my-code
```

첫 명령은 중간언어만 생성합니다. 둘째 명령은 `plan.json`·`trace.json`을 읽고 `inference.json`만 저장합니다. `--out-dir`로 추론 결과 폴더를 따로 지정할 수 있습니다. 생성 기록은 덮어쓰지 않습니다.

`observations.plan.json`·`observations.trace.json`은 선택적 보조 근거입니다. 함께 있으면 런타임 배열·과거 레코드 관계 등의 기존 근거도 사용할 수 있습니다. 없으면 공개 중간언어에 있는 근거만 사용하며 없는 관측을 만들지 않습니다. 이전 실행의 보조 파일이 남아 식별자가 다르면 추론 진단으로 알립니다.

## 기존 호출부 전환

- `scripts/model/index.mjs`는 `traceModel`, `compileCToIR`, `describeLogicalWork`만 공개합니다.
- 추론·추천·저장 관계 조회 API는 `scripts/inference/index.mjs`에서 가져옵니다.
- `traceModel`의 기본 동작은 추론 미실행입니다. 기존 `inference:false`는 호환되며, `inference:true`는 별도 API를 사용하라는 오류를 냅니다.
- 추론 검사만 별도 도우미로 생성 → 추론 → 조회 객체 생성을 명시합니다. 중간언어 검사는 생성 API를 직접 사용합니다.

검증 근거는 [모델 분리 검증](../validation/inference-separation-2026-11-11.md)에 기록합니다.

## 그래프 저장 역할의 재관측

비교에서 발견한 끝점·저장소·속성 역할은 이후 동일한 AST 접근 위치의 실제 읽기에도 적용합니다. 단락 평가 때문에 비교 대상의 읽기가 생략되어도, 이미 읽힌 인접 저장소만으로 새 간선을 관측할 수 있습니다. `storageRoles`는 선행 역할 근거, `storageEvidence`는 실제 READ·인덱스 값·속성 위치, `absenceEvidence`는 부재 확인 근거입니다. 가상의 READ나 CALC를 중간언어에 추가하지 않습니다.

정점 후보는 간선 끝점과 알려진 정점 저장 영역의 실제 인덱스 접근을 사용합니다. 배열 용량만큼 자동 생성하지 않으며 `membership.status='candidate'`로 논리적 사용 범위의 불확실성을 남깁니다. 예약 영역 초기화가 실제 정점 사용과 같은 의미라고 확정하지 않습니다.

관련 쓰기는 기존 간선을 미확정으로 만듭니다. 같은 인접 행의 정상 종료와 누락 없는 읽기를 확인하거나, 선행 근거가 있는 부재 조건을 실제 관측한 뒤에만 `absent`로 바꿉니다. 중도 이탈·건너뛴 원소·관련 쓰기가 있는 순회와 복합 종료 조건은 부재를 확정하지 않습니다. 삭제는 논리 관계의 상태이며 원래 메모리 수명과 실행 기록을 바꾸지 않습니다.

구현·반례·남은 범위는 [그래프 저장 관계 보완](../validation/graph-storage-fixes-2026-11-11.md)을 참고하십시오.

연관 조회의 키·버킷·충돌·슬롯 상태·항목 전달은 [해시 후보 계약](associative-lookup-inference.md)을 따릅니다. `queryAssociativeLookup`은 기존 실행을 소비하는 조회 API이며 생성 모델의 사건을 수정하지 않습니다.

문자 선택·입력 소비·종료 표지와 트라이 추천은 [문자열 경로 계약](sequence-lookup-inference.md)을 따릅니다. `querySequenceLookup`은 희소 포인터 자식, 분리 인덱스 배열, 자식/형제, 내부 간선 레코드의 관계를 실행 시점별로 조회합니다. 생성 모델과 원래 저장 관계는 변경하지 않습니다.
