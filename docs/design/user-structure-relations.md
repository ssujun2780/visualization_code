# 사용자 지정 관계 API

2026-11-12. UR-01~08은 공통 추론 API 구현 계약입니다. 우클릭 입력·배치·렌더링 UI는 포함하지 않습니다.

## UR-01 역할 지정과 실행 사실

자동 추론이 연결을 발견하지 못해도, 사용자가 노드 저장소와 연결 역할을 지정할 수 있습니다. `defineStructureRelation(trace, spec)`은 실행에 종속된 JSON 지정 객체를 반환합니다. 이름·값의 유사성으로 관계를 추측하지 않습니다. 역할 지정은 원본 객체·값·사건을 만들거나 변경하지 않습니다.

```js
const relationBinding = defineStructureRelation(trace, {
  nodes: {kind: 'array', objectId: values.id},
  roots: [{kind: 'index', source: {kind: 'slot', objectId: root.id},
    signed: true, nullValues: [-1]}],
  links: [
    {id: 'left', kind: 'index',
      source: {kind: 'array', objectId: left.id}, nullValues: [-1]},
    {id: 'right', kind: 'index',
      source: {kind: 'array', objectId: right.id}, nullValues: [-1]}
  ]
});
const relation = queryStructureRelations(trace, {relationBinding, afterExecutionId});
const check = queryStructureConditions(trace, {
  relationBinding, afterExecutionId, expected: 'tree'
});
```

`left`/`right`는 사용자가 부여한 역할 식별자이며 이름에 따른 코드 분기는 없습니다. `trace.structures`가 비어 있어도 동작합니다. 자동 후보의 타입·조건·추천 순위는 바꾸지 않습니다.

## UR-02 저장 표현

- `nodes.kind: array`: `objectId`, `offset`, `size`, `stride`, `count`. 생략한 크기·간격·개수는 실제 배열 타입과 객체 범위에서 얻습니다. 비정형 할당은 해당 범위를 명시합니다.
- `nodes.kind: records`: `recordTypeId`. 실제 객체 타입 및 해당 시점까지 기록된 타입 있는 참조에서 같은 레코드 범위를 찾습니다. 개별 할당마다 지정할 필요가 없습니다. 미래에 관측한 타입 참조를 과거 노드 발견의 근거로 사용하지 않습니다.
- 연결 값: `kind: index | pointer`. 인덱스는 배열 노드의 논리 인덱스와 대응합니다. `indexBase`(기본 0), `signed`(기본 true), `nullValues`(기본 빈 배열)를 명시할 수 있습니다. 큰 정수는 문자열로 보존합니다. `-1`이나 0을 자동 종료값으로 간주하지 않습니다.
- 연결 저장 위치: `source.kind: field`의 노드 기준 `offset,size`, 또는 `source.kind: array`의 별도 객체·간격·개수. 구조체 필드, 분리 배열, 교차 저장 배열을 같은 경로로 읽습니다.
- `roots`: 관측 `slot`에 든 포인터/인덱스, 또는 명시한 인덱스 `value`의 배열입니다. 있으면 도달한 노드만 선택하고, 생략/null이면 전체 관측 노드, 빈 배열이면 명시적인 빈 관계입니다. 여러 루트와 같은 저장소의 여러 보기를 허용합니다.

포인터는 기록된 대상 객체 ID와 오프셋으로 연결합니다. 현재 C 실행 대상의 0 비트 NULL 표현 외의 바이트를 주소 숫자에 맞춰 새 참조로 추측하지 않습니다. 관측 출처가 없는 비영 포인터, 레코드 타입 발견 누락, 미관측 바이트는 `incomplete`입니다.

## UR-03 시점·수명·한도

조회는 요청 사건까지의 SPACE/READ/WRITE 관측만 읽습니다. 최종 메모리·미래 변경·자동 후보의 마지막 상태를 가져오지 않습니다. 연결 재대입, NULL 전환, 바이트 일부 변경을 반영하며 해제된 할당을 같은 숫자 주소로 되살리지 않습니다.

`nodes`, `edges`, `terminals`, `rootObservations`에는 실제 범위·식별자·근거 사건을 남깁니다. 노드 ID는 저장 객체와 범위에 대응합니다. `missing`은 관측 부족, `violations`는 확인된 잘못된 연결입니다. 종료값을 가상 메모리 노드로 만들지 않습니다.

기본 조회 한도는 노드 4096개, 연결 읽기 16384개이며 `relationLimits: {maxNodes,maxEdges}`로 지정합니다. 한도 도달은 `coverage.limited`와 불완전 상태로 표시합니다. 실행 기록이 없어진 부분을 만들어 채우지 않습니다. 생성 전은 불완전, 지정의 기준 저장소 수명 종료는 ended, 살아 있는 루트에서 해제된 대상으로 이어지면 dangling 경고입니다.

## UR-04 조건과 사용자 우선

`setStructurePresentation`에 `relationBinding`을 전달하면 실행·대상·slot에 함께 저장합니다. `resolveStructurePresentation`은 `relationView`와 기존 `expectationCheck`를 반환합니다. `expected: null`과 사용자 정의 표현에서도 관계는 조회됩니다. 모순·해제·후보 소멸로 지정이 자동 해제되지 않으며, 자동으로 돌아가기를 선택하면 해당 slot만 지웁니다. 추천 최대 5개 정책은 그대로입니다.

기존 graph/tree/forest/chain 등의 조건 검사를 재사용합니다. 범위 밖 인덱스·dangling 참조는 구조 경고이며 C 오류 사건을 생성하지 않습니다. 실제 순환·공유 자식을 숨기거나 고치지 않습니다. `conditionBindings`의 키·색·높이 지정도 함께 사용할 수 있습니다. 트리 지정만으로 BST 비교 계약이나 임의 사용자 조건이 생기지는 않습니다. 알 수 없는 조건은 `not-checkable`입니다.

## UR-05 경계와 남은 일

이 API는 명시한 관계를 관측 기록 위에 해석하는 기능이며 자동 추론기의 정답을 주입하는 기능이 아닙니다. 임의 C/JavaScript 실행식·콜백은 포함하지 않습니다. UI 입력·저장·그림은 별도 작업입니다. 지정은 JSON 직렬화 가능하며 다른 실행의 원본 바인딩을 직접 사용하면 거부합니다. 가변 인접 목록과 선언형 조건은 UR-06~08, 재할당·재실행 재연결은 UR-09~11을 따릅니다.

## UR-06 실행 관계 분석과 연결

```js
const structureInput = createStructureRelationInput(trace, {
  structureInference: inference, // 생략 가능
  relations: [{relationBinding, roleIds: null}],
  maxStates: 2048, maxQueries: 20000
});
const work = inferExecutionRelations(plan, trace, {
  outputSchemaVersion: 2, structureInference: structureInput
});
```

별도 소비자 입력을 반환합니다. 기존 추론 결과와 원본 실행은 변경하지 않으며, 수동 관계에는 `origin: user`를 남깁니다. 자동 후보·추천을 수동 관계로 대체하지 않습니다. 시점별 구성원과 실제 저장 범위로 `storageBindings`를 만들고 기존 실행 관계 v2의 `structure-access`가 소비합니다. 분리 링크·개수·인접 항목 범위도 해당 논리 구성원의 `parts`로 연결합니다. 원래 객체와 바이트 범위는 유지합니다.

연결 변경·이탈·재진입·해제에서 대응 기간을 닫고 다시 엽니다. 이력 출력 한도는 공통 prefix/latest와 생략 구간 규칙을 사용합니다. 조회 작업 한도에 도달하면 그 이후 구간을 미확정으로 닫으며 오래된 대응을 이어 쓰지 않습니다. `diagnostics`에 한도를 구별합니다. 기존 UI·실행 관계 분석기로의 자동 호출은 추가하지 않습니다.

## UR-07 가변 인접 저장 방식

하나의 연결 역할에서 여러 대상이 나오는 경우 `source.kind`를 확장합니다. 최종 연결 값의 `index/pointer`, 부호·종료값·기준 인덱스는 기존 규칙과 같습니다.

- **span**: `storage`, `start`, 그리고 `count` 또는 `end` 하나를 지정합니다. 좌표는 음수가 아닌 상수 또는 관측 `field/array/slot`이며, 슬롯 좌표의 `signed` 기본값은 true입니다. CSR의 offsets[i]~offsets[i+1], 시작+개수, 고정 폭 배열 안의 사용 구간을 같은 경로로 읽습니다.
- span 저장소는 `storage: {kind:'array',objectId,offset,size,stride,count}` 또는 `{kind:'indirect',pointer:{kind:'field',offset,size},size,stride}`입니다. 간접 포인터는 노드별 배열/slot에서도 읽을 수 있습니다. 현재 기록된 대상과 크기만 사용합니다. 길이 0은 NULL을 역참조하지 않으며, 잘못된 길이·범위는 구조 경고입니다.
- **chain**: `entries`(배열 또는 레코드 타입), `head`, `next`, `item`을 지정합니다. head/next는 기존 index/pointer 명세이며, next/item은 인접 항목 안의 필드입니다. 포인터 연결 목록과 배열 인덱스 목록에 같은 경로를 적용합니다. 보조 연결 항목은 원래 저장소로 유지하며, 논리 간선에 실제 `sourceRange`, `viaRanges`, 근거 사건을 남깁니다.

```js
// CSR의 한 연결 역할. offsets와 targets는 실제 객체 ID입니다.
{id:'out', kind:'index', nullValues:[], source:{kind:'span',
  storage:{kind:'array',objectId:targets,size:4},
  start:{kind:'array',objectId:offsets,size:4,stride:4,count:nodeCount},
  end:{kind:'array',objectId:offsets,offset:4,size:4,stride:4,count:nodeCount}
}}
```

연결 항목 자체의 순환은 `relation-container-cycle`, 그래프 노드 간 순환은 기존 위상 조건으로 구분합니다. 동일 대상을 가리키는 여러 간선을 합치지 않습니다. 항목 읽기·좌표·다음 연결도 조회 한도를 소비합니다. 한도·미관측이면 해당 지점을 표시하고 중단합니다.

## UR-08 선언형 비교·사용자 조건

`defineStructureConditionRules(trace, spec)`으로 검증·정규화한 지정 또는 원래 spec을 `queryStructureConditions(..., {conditionRules})`와 `setStructurePresentation(..., {conditionRules})`에 전달합니다. 새 실행 코드를 실행하는 기능이 아닙니다.

`order.components`는 각 키의 `source`(field/array/slot), `domain`(integer/float/string), `signed`, 사전식 비교 방향 `direction`(1/-1)을 지정합니다. 문자열의 `storage`는 inline/pointer입니다. `order.roles`는 두 연결 역할의 `roleId`, `direction: less|greater`, `duplicates: allow|exclude|unknown`을 지정합니다. 실제 키 바이트·출처를 공통 BST 조상 경계 검사기에 전달하므로 부모와만 비교하지 않습니다. 사용자 순서 계약을 자동 추론했다고 기록하지 않으며, 명시한 계약이 우선합니다.

`properties`는 같은 속성 범위 명세의 이름별 목록입니다. `conditions`는 고유한 `custom:` ID, `requires` 선행 조건과 `rules` 배열입니다. 지원하는 규칙은 다음과 같습니다.

| kind | 지정 항목 | 검사 |
| --- | --- | --- |
| degree | direction in/out, min/max, roleIds | 구성원별 해당 연결 개수 |
| value | property, operator, value, scope nodes/roots | 관측 속성과 명시한 상수 비교 |
| edge-order | property, operator, roleIds | 각 연결의 출발·도착 구성원 속성 비교 |
| reciprocal | forwardRoleId, reverseRoleId | 실제 반대 방향 연결 존재 |

비교 연산자는 `< <= > >= == !=`입니다. 조건을 조합해 최대 자식 수, 루트 속성, 부모 우선순위, 양방향 연결 등을 검사할 수 있습니다. 키·속성은 정확한 정수, float32/64, 관측된 NULL 종료 바이트 문자열을 사용합니다. NaN/누락/역할 미확정은 불완전으로 남습니다. 알 수 없는 선행 조건은 not-checkable이며 조건 의존성 순환과 내장 조건 이름 덮어쓰기는 거부합니다. 관측된 위반은 구조 경고이고 프로그램 ERROR가 아닙니다. 임의 비교 함수의 의미나 알고리즘 정확성을 자동 증명하지 않습니다.

## UR-09 재할당 연결

`resolveStructurePresentation`은 요청 사건까지 관측된 `realloc-replaced` 종료와 대응하는 힙 생성·`copiedFrom` 기록으로 사용자 지정 저장소를 연결합니다. 같은 주소에서의 재할당도 새로운 객체 ID를 따릅니다. 재할당 실패·일반 복사·free 후 같은 주소 재사용은 교체 근거가 아닙니다. 미래 교체 기록을 과거 조회에 적용하지 않습니다. 교체 종료와 생성 사이에는 `replacement-not-observed`를 반환합니다.

선택 대상을 `objectId/objectIds`로 지정했다면 전체 객체 선택은 새 할당 크기를 따릅니다. 명시적 `ranges`, 관계/조건의 `offset,size,stride,count`는 원래 지정 범위를 보존합니다. 성장한 용량을 새 논리 원소라고 가정하거나 범위를 자동 확대하지 않습니다. 축소 후 지정 범위가 들어가지 않으면 `mapped-range-out-of-bounds`로 재연결을 보류합니다. 새 범위 선택은 setter로 명시합니다.

관계의 nodes/roots, 중첩 span/chain, 선언형 속성·복합키 및 기존 조건 역할을 한 번에 변환합니다. 한 항목이라도 대응하지 못하면 어떤 항목도 부분 적용하지 않습니다. 실제 포인터 바이트, dangling 참조, 사건 순서·수명은 변경하지 않습니다. 자동 추론 후보 ID는 실제 저장 근거가 유일할 때만 연결합니다.

현재 재할당 객체를 선택해 setter/clear를 호출해도 원래 설정을 찾아 해당 slot만 갱신·해제합니다. 조건 범위만 축소로 무효해진 경우에도 선택 대상의 신원이 확인되면 기존 수동 표시와 재연결 필요 안내를 유지합니다. 이 선택 대응은 조건/관계를 부분 적용하는 동작과 구별합니다.

## UR-10 같은 코드 재실행

```js
const preferences = setStructurePresentation(null, trace, {
  target: {objectId}, view: 'tree', relationBinding, conditionRules, plan
});
// plan을 받은 setter가 JSON 직렬화 가능한 컴파일러 앵커를 함께 저장합니다.
const restored = reconnectStructurePresentation(preferences, {
  plan: nextPlan, trace: nextTrace,
  sourceScope: {programId: trace.programId, runId: trace.runId}
});
const view = resolveStructurePresentation(nextTrace, {
  target: nextTarget, preferences: restored.preferences, afterExecutionId
});
```

정확한 소스 해시와 컴파일러 타입 배치를 먼저 확인합니다. 그 뒤 AST 선언/할당 호출의 소스 범위, 함수·호출 경로와 타입 배치를 대조합니다. 이름만 같거나 객체 ID/주소가 재사용되었다는 이유로 복원하지 않습니다. 같은 선언을 반복 실행한 여러 객체는 순번으로 맞추지 않습니다. 레코드 타입 식별자도 컴파일러 필드·타입 정보로 재연결합니다. 직접 소스를 다시 파싱하거나 생성 모델을 호출하지 않습니다.

`captureStructurePresentationAnchor(plan, trace, setting)`은 기존 정규화 설정에 사용할 앵커를 제공합니다. `reconnectStructureSetting(trace, setting, {plan, afterExecutionId})`은 관계·조건을 포함한 단일 설정의 원자적 변환 결과를 반환합니다. 직접 관계/조건 API 또는 실행 관계 입력을 사용하는 소비자는 성공 결과의 `setting.relationBinding/conditionRules`를 해당 시점에 함께 사용합니다. 원본 run-scoped 바인딩 자체를 변경하지 않습니다.

## UR-11 모호함·누락·충돌

결과는 `connected` 또는 `reconnect-needed`입니다. 후자에는 원래 설정 전체와 진단을 보존합니다. 재실행 결과의 `preferences.pending` 및 `pending` 목록, 화면 소비 조회의 `pendingReconnections`로 노출합니다. 대상이 불명확한 설정을 임의 객체에 붙이거나 추천 1위로 바꾸지 않습니다. 같은 대상으로 여러 사용자 설정이 충돌해도 먼저 발견한 것을 선택하지 않습니다.

소스/타입 배치 변경, 관측되지 않은 객체, 여러 대응 객체, 미지원 컴파일 근거, 범위 축소를 구분합니다. 일반 배열 후보와 실제 루트 저장 범위가 있는 후보는 물리 대응을 대조합니다. 안정된 근거가 없는 후보 식별자·자동 추론 역할 식별자는 재연결 필요로 남습니다. 사용자 관계에 명시한 역할 이름은 그대로 보존합니다. 근거가 새로 들어오면 원본 설정에서 다시 시도할 수 있으며, 이미 같은 출처에서 복원한 설정을 재시도해도 중복 생성하지 않습니다. 수동 재지정은 기존 setter를 사용합니다.

UI의 경고·선택 메뉴·영속 저장 연결은 이 API 구현에 포함되지 않습니다. 코드가 변경된 경우 임의 자동 이식은 하지 않습니다.

## UR-12 자동 추론에서 선택한 역할 복원

`setStructurePresentation(..., {plan, roleIds, afterExecutionId})`는 선택한 자동 역할과 조건 안의 역할 참조를 컴파일러·관측 근거에 연결하여 저장합니다. `afterExecutionId`를 생략하면 마지막 기록까지 확인합니다. `reconnectStructurePresentation` 및 기존 시점별 resolver가 이를 사용하며 생성 모델이나 자동 후보를 변경하지 않습니다.

- 구조체 포인터 필드는 필드 선언과 소유 레코드의 AST 범위, 타입 배치, 필드 바이트 오프셋·폭으로 대응합니다. 접근 코드 위치만 같거나 이름만 같은 것은 근거가 아닙니다.
- 포인터 배열 필드의 각 슬롯은 소유 필드와 실제 상대 오프셋·폭으로 구별합니다. 같은 타입의 여러 필드/슬롯을 하나로 합치지 않습니다.
- 분리 연결 배열은 실제 배열 범위·원소 간격·차원과 관측된 인덱스 역할로 대응합니다. 레코드 인덱스는 저장 배열과 필드를 함께, 표 기반 인덱스는 저장 배열과 열을 함께 연결합니다. 값이나 원소 수가 같다는 이유로 역할을 생성하지 않습니다.
- 같은 루트에 단일 역할·여러 역할 보기가 공존하면 선택한 역할 집합과 인덱스 저장 영역도 대조합니다. 일부 역할만 있는 후보나 다른 저장 영역의 후보로 바꾸지 않습니다.
- 전체 할당을 나타내는 자동 배열 역할은 실제 realloc 교체와 새로 관측된 배열 정의에 따라 크기가 달라질 수 있습니다. 이것은 자동 관계가 관측한 사용 범위이며, UR-09의 명시적 고정 관계 범위를 자동 확대하는 규칙이 아닙니다.

반환 정보의 `roleMappings`, `fieldMappings`는 이전/현재 식별자 대응입니다. `roleIds`, 조건의 `order.roles[].roleId`, 규칙의 `roleIds`·`forwardRoleId`·`reverseRoleId`를 한 번에 갱신합니다. 직접 만든 `relationBinding`의 사용자 역할 이름은 재해석하지 않습니다.

선언/역할/후보가 하나로 대응할 때만 적용합니다. 역할 미관측, 같은 저장 근거의 복수 후보, 타입·필드 배치 불일치, 지원 근거 누락은 구별된 진단과 `reconnect-needed`로 남습니다. 미래에 발견한 역할을 과거 시점으로 가져오지 않습니다. 원래 선택·조건은 보존하고 선택 해제·재지정 경로도 유지합니다.

저장소 그래프 소비자 `queryStorageReferences`도 재연결 실패 시 관계를 부분 적용하지 않습니다. `relationAvailable:false`, `topology:null`, `assessment:incomplete`로 반환하며, 필터 결과가 없다는 이유로 정상적인 빈 트리라고 판정하지 않습니다. 이 상태의 빈 nodes/edges는 빈 자료구조의 증거가 아닙니다.

## UR-13 저장소와 의미 역할로 자동 후보 재연결

자동 후보를 `structureId`로 직접 선택한 경우에도 물리 저장소와 후보의 구별 근거를 함께 저장합니다. 큐/커서 구간은 앞·뒤 및 count/full 저장 위치와 인덱스 오프셋, 인덱스 트리는 차수·기준 인덱스·자식 배치·비교 필드, 대표 관계는 부모 필드, 구간 집계는 집계 배열, 연관 조회는 버킷 저장소와 키 역할을 대응합니다. 복합 우선순위는 저장 배열·레코드 배치·실제 호출된 비교 함수의 컴파일러 소스 위치를 대응합니다.

이름·현재 값·노드 수·일시적인 후보 ID는 신원 근거가 아닙니다. 비교 함수의 식별자가 바뀌어도 선언이 유일하게 대응하면 복원합니다. 같은 배열의 다른 앞/뒤 역할, 다른 비교 함수, 다른 인덱스 배치는 서로 다른 후보입니다. 동일 근거의 후보가 여러 개면 첫 후보를 선택하지 않습니다. 발견 전에는 후보를 연결하지 않으며, 관계·조건을 함께 이동하는 UR-09~12 규칙은 그대로 유지합니다.

복합 비교자에서 현재까지 관측한 키 필드 목록은 후보의 신원이 아닙니다. 같은 비교 함수라도 재할당 뒤 동점 분기를 실행하지 않았을 수 있습니다. 이때 사용자 선택은 재연결하고 현재 비교 정책은 불완전으로 유지합니다. 이전 객체의 완성된 키 순서나 조건 판정을 새 객체로 복사하지 않습니다.

지원 스키마를 확인할 수 없는 후보는 원래 지정과 `candidate-anchor-missing`을 보존합니다. 이는 자동 추론 결과를 제거하거나 자료구조 자체가 없다고 판정하는 동작이 아닙니다.

## UR-14 복합 후보 구성 관계 재연결

지연 갱신 후보는 집계 후보와 태그 배열, 선택 관계 후보는 대표 관계와 원본·선택 대상 배열을 역할별로 재귀 대응합니다. 포인터 대표 관계는 레코드 타입 배치와 부모 필드 오프셋으로 대응합니다. 구성원 하나라도 미관측·누락·모호하면 전체 설정을 보류합니다. 구성 관계 순환은 재연결 근거로 인정하지 않습니다. 구성 후보도 요청 시점까지 발견되어야 합니다.

공유 후보는 현재 스키마의 `all-observed-peer-roots` 범위 전체를 나타내는 컬렉션입니다. 현재 공유 쌍·노드 수는 컬렉션의 내용이므로 재실행 신원에 사용하지 않습니다. 범위가 다른 공유 후보를 동일시하지 않으며, 같은 범위 후보가 여럿이면 모호함으로 보류합니다. 개별 공유 쌍 고정은 이 컬렉션 선택과 별도입니다.

재할당은 구성 저장소별 실제 교체 근거에 따라 적용하며 일반 복사를 따라가지 않습니다. 기존 관계·조건의 원자적 재연결 규칙을 유지합니다. 비교 함수 후보는 함수 선언뿐 아니라 반환 판정 규약(`truth`, `<`, `>` 등)도 구별합니다. 같은 함수의 반대 판정 정책을 서로 연결하지 않습니다.
