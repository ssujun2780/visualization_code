# 자료구조 추천과 사용자 지정 우선 규칙

2026-11-09. 공통 모델의 정책과 조회 API입니다. 우클릭 메뉴·레이아웃·설정 저장 UI는 다른 세션에서 구현합니다.

## 적용 규칙

1. 선택한 대상의 추론 후보를 **최대 5개** 추천합니다. 서로 다른 자료구조 표현을 기준으로 중복을 합치며, 같은 표현의 여러 역할 해석은 `alternatives`에 보존합니다. 후보가 부족하면 5개를 채우지 않습니다.
2. 추천은 관측 근거의 강도, 근거 범위, 안정적인 식별자 순으로 정렬합니다. `rank`는 1부터 시작합니다. 순위와 내부 `strength`는 확률이나 의도 확정도가 아닙니다. 미래 사건의 근거나 현재 시점까지 반례가 확인된 후보를 추천에 포함하지 않습니다.
3. **사용자 지정이 자동 추천보다 우선**합니다. 추천에 없는 배열·트리·사용자 정의 표현도 지정할 수 있습니다. 재조회·새 추론·후보 소멸·관측된 모순만으로 자동 해제하거나 다른 표현으로 바꾸지 않습니다.
4. 사용자가 ‘자동 추론으로 돌아가기’를 선택하면 해당 지정만 해제합니다. 자동 모드의 기본 표현은 현재 추천 1위이며, 추천이 없으면 기본 상자 표현입니다.
5. 사용자 지정은 해당 표현의 조건만 적용합니다. BST나 heap을 추천했더라도 일반 트리로 지정하면 BST 정렬·heap 순서 조건을 상속하지 않습니다. 일반 트리의 기본 기대 조건은 `tree`이고, `expected: null`로 기대 조건 검사를 끌 수 있습니다.
6. 원래 후보와 실제 값·포인터·공유·순환·수명·중간언어 사건은 유지합니다. ‘트리로 지정’은 순환을 지우거나 실제 그래프를 수정하는 작업이 아닙니다. 모순은 표현을 유지한 채 구조 경고로 다룹니다.

대상은 `structureId`, 하나 또는 여러 `objectId`, 또는 `objectId + offset + size` 범위 묶음입니다. 같은 객체 안의 다른 범위를 구별합니다. 설정은 `programId + runId + 대상 + slot`에 묶이며, 같은 저장소의 배열 보기와 트리 보기는 서로 다른 `slot`으로 독립 지정할 수 있습니다.

새 실행에서 객체 식별자가 재사용되더라도 이전 실행의 지정을 자동 적용하지 않습니다. 실행을 넘어 설정을 재사용하려면 선언·필드 대응을 확인하는 별도 연결이 필요합니다. 현재 설정 객체는 JSON으로 직렬화할 수 있지만 파일/서버 저장 및 코드 변경 후 재연결은 구현하지 않았습니다.

## 공통 API

구현은 `scripts/model/structure-presentation.mjs`이며 `scripts/model/index.mjs`에서도 export합니다. 추천은 클릭 대상과 시점에 따라 달라지므로 trace 생성 시 모든 대상에 대해 미리 계산하지 않고 조회 시 계산합니다.

```js
const target = {objectId: object.id};

// 자동 후보: 0~5개, rank·근거·역할 대안 포함
const recommendations = recommendStructureViews(trace, {
  target, afterExecutionId
});

// 새 설정 객체 반환. 이전 설정과 trace를 수정하지 않음
preferences = setStructurePresentation(preferences, trace, {
  target,
  view: 'tree',
  slot: 'primary'
});

const presentation = resolveStructurePresentation(trace, {
  target, afterExecutionId, preferences, slot: 'primary'
});
// mode: manual, source: user, locked: true, view: tree,
// expected: tree, recommendations: 현재 자동 추천 최대 5개

preferences = clearStructurePresentation(preferences, trace, {
  target, slot: 'primary'
});
```

`setStructurePresentation(..., {view: 'auto'})`도 해당 지정의 해제입니다. `view: 'custom:my-structure'`처럼 추천에 없는 식별자도 허용합니다. 사용자 정의 표현의 렌더러나 규칙 검사기를 자동으로 만들어 주지는 않습니다.

`roleIds`는 지정한 관계만 선택할 때 사용합니다. 사용자 지정 시 생략하면 추론 후보의 역할/하위 유형 조건을 몰래 상속하지 않고 대상 전체에 대한 표현 지정을 남깁니다. 역할 식별자는 후보의 원본 모듈에 대응하며, 예를 들어 저장소 참조 그래프는 `field:ast...` 형식입니다.

`resolveStructurePresentation`의 주요 반환값:

| 필드 | 의미 |
|---|---|
| `mode`, `source`, `locked` | 자동/사용자 지정 및 고정 여부 |
| `view`, `roleIds`, `expected` | 적용할 표현·역할·기대 조건 |
| `recommendations` | 사용자 지정과 별도로 유지하는 현재 추천 최대 5개 |
| `inferredCandidateId` | 자동 선택의 근거. 사용자 지정이면 null |
| `contractPolicy` | 선택한 표현만 적용하며 추론 하위 유형 조건을 상속하지 않음 |

## 기존 추론 결과와의 연결

현재 배열·격자, 동적 배열, 리스트/트리/그래프 위상, 큐·스택·deque, 인덱스 트리 등의 관측 메타데이터를 추천 후보로 연결합니다. 단순히 트리 모양이라는 이유로 BST를 추천하지 않습니다. 힙 추천은 실제 인덱스 관계·비교 근거와 관측 순서 조건을 함께 요구하며, 그래도 작성 의도는 `unconfirmed`입니다.

향후 추론 모듈은 해당 structure에 다음처럼 `presentationCandidates`를 제공할 수 있습니다. 특정 예제나 변수 이름을 등록하는 방식이 아닙니다.

```js
{
  view: 'bst',
  status: 'supported', // 또는 partial
  supportingExecutionIds: ['x10', 'x20'],
  contradictingExecutionIds: [],
  discoveredAtExecutionId: 'x20',
  roleIds: ['left-role', 'right-role'],
  expected: 'bst-order'
}
```

이 예시는 확장 계약입니다. 현재 BST 의미 판별기나 `bst-order` 검사기가 구현됐다는 뜻은 아닙니다. 이름만 있거나 관측 근거가 없는 후보는 추천하지 않습니다.

`queryStorageReferences`에도 같은 정책을 연결했습니다. 저장소 그래프에 고정하려면 `target: {structureId: graph.id}`로 설정하고 조회에 `preferences`와 `slot`을 넘깁니다. 저장된 사용자 지정은 조회에 들어온 다른 자동 표현/기대 조건보다 우선합니다. 기존의 직접 `view` 인자는 그 조회에서만 쓰는 표현이며, 지속 고정에는 `setStructurePresentation`을 사용합니다.

구조 기대 조건은 기존 tree/forest/chain 위상 검사 범위를 따릅니다. 지원하지 않는 사용자 규칙은 `not-checkable`, 관측 부족은 `incomplete`로 남깁니다. 사용자 C 실행 오류와 구별합니다.

## 확인 범위

`tests/ir-structure-presentation.test.js`에서 다음을 확인했습니다.

- 5개 상한, 중복 후보의 역할 대안 유지, 안정적인 정렬, 부족한 후보를 채우지 않음.
- 시점 이전의 근거만 사용하고 다른 객체/하위 범위의 후보를 섞지 않음.
- BST/heap 추천과 독립적인 일반 트리 고정, 후보 소멸·JSON 저장/복원 후에도 유지.
- 대상·실행·보기 slot별 격리와 자동 복귀, 임의 사용자 표현.
- 실제 C 배열/포인터 트리 추천과 실제 순환을 보존하는 사용자 트리 경고.

기존 저장소 조회의 flexible child array, 미확정 바이트 덮어쓰기·주소 재사용 검사도 함께 확인합니다. 예제 전체나 UI 검사는 실행하지 않습니다.
