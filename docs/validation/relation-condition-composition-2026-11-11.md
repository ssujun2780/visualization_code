# 관계·조건 조합 적용 검증

2026-11-11. 사용자 요청에 따라 공통 추론기와 관련 docs만 보완했습니다. 중간언어 생성 모델과 UI는 수정하지 않았습니다.

## 적용 계약

구현 전에 읽은 문서: `presentation.md`의 모델 경계, `inference-model.md`의 생성/추론 분리, `structure-presentation-policy.md`의 추천/사용자 지정, `tree-inference-projections.md`와 `bst-inference.md`의 저장 정체성·위상·순서 조건. `execution-relations.md` R-02/R-04/R-06/R-07의 실행 보존·현재 근거·불완전성·일반화 원칙도 적용했습니다.

이번 구현 계약은 [structure-composition.md](../design/structure-composition.md)의 RC-01~08에 정리했습니다. 앞서 제안한 모든 12계열의 자동 판별을 완성하는 작업은 아닙니다.

| 조항 | 변경 위치와 동작 | 검증 근거 | 상태 |
| --- | --- | --- | --- |
| RC-01/02 | `structure-relations.mjs`: 포인터·정수 인덱스·논리 트리 보기의 공통 관계와 원본 연결 | 실제 구조체와 분리 배열에서 구성원 3개·간선 2개, 별도 반환 객체 불변성 | 구현 |
| RC-03 | `structure-conditions.mjs`, `bst-views.mjs`: BST 조건을 실제 공통 경로로 이동, 조건 의존성 합성 | 기존 정수/복합 키·큰 unsigned·조상 위반·회전·중복 정책 검사 | 구현 |
| RC-03/04 | AVL 실제 높이 및 별도 캐시 검사, RB 색·루트·빨강 연속·검은 높이·NIL 검사 | 유효 RB지만 AVL이 아닌 반례, 오래된 캐시, 개별 색 위반, 미관측 NIL 색 | 조건 구현; 자동 색/높이 역할 판별은 미구현 |
| RC-04/07 | `condition-query.mjs`: 현재 기록의 속성 바이트, 명시적 record/array·mask 지정 | 구조체 색 비트와 별도 배열의 17/29 표현, 변경·복구, 미래 시점/다른 대상 배제 | 구현 |
| RC-05 | 확인/위반/불완전/미지원/종료와 의존 조건 보존 | 부분 연결의 복수 루트, 순환·공유 자식·DAG, 이력 누락·종료·미지원 | 구현 |
| RC-06 | `structure-presentation.mjs`: 선택 후보 범위 검사와 사용자 지정 조건 연결 | 기존 수동 우선·상위 5개 정책, 잘못된 키에도 일반 tree는 통과, RB 지정은 위반해도 유지 | 구현, UI는 범위 밖 |
| RC-07 | `bst-contract.mjs`: 조건→원본 관계·역할·시점 독립 검사 | 관계 근거를 미래 사건으로 바꾼 변조 입력 거부, 생성/추론 분리 검사 | 구현 |
| RC-08 | docs에 확장 절차·기존 전용 추론·남은 범위 명시 | 아래 범위 확인 | 일부 계열 어댑터/조건은 후속 |

## 실행 전 기대값

새 검사 파일은 `tests/ir-structure-composition.test.js`입니다. 후보 결과에서 정답을 추출하지 않고 다음 구조와 상태를 기대값으로 두었습니다.

- 루트 20, 자식 10/30: BST·균형 조건 만족.
- 같은 그래프에서 키 역할을 주지 않음: binary-tree/avl-balance는 검사할 수 있으나 전체 AVL은 `not-checkable`.
- 색 역할을 주지 않음: 전체 RB는 `not-checkable`.
- 구조체 색 비트: A 정상 → B 빨간 루트 → C 검은 높이 불일치 → D 복구 → E 키 순서만 위반. 실제 출력은 `A 5`, `B/C/D/E 3`.
- 분리 배열: 같은 3개 노드·2개 간선과 검정 17/빨강 29. 실제 출력 `A 5`, 전체 RB 조건 만족.
- 왼쪽 높이 1/오른쪽 높이 3인 유효 RB 구성: AVL은 위반하지만 RB는 만족.
- 실제 NIL 객체를 지정한 경우 색이 없으면 미확인, 검정이면 만족, 빨강이면 종료 색 위반. NIL을 데이터 노드로 추가하지 않음.
- 공유 자식은 DAG일 수 있으나 트리는 아님. 부족한 연결 때문에 루트가 여러 개로 보이는 부분 상태는 확정 위반으로 바꾸지 않음.

## 실행 결과

관련 6개 검사 파일 **46개 통과**:

```text
tests/ir-structure-composition.test.js
tests/ir-bst-inference.test.js
tests/ir-bst-composite.test.js
tests/ir-structure-presentation.test.js
tests/inference-separation.test.js
tests/ir-tree-inference.test.js
```

마지막 변경(동일 의미 상태 중복 기록 방지·선택 대상 범위 확인) 후에는 영향 있는 composition/BST/separation **20개를 다시 검사하여 통과**했습니다. 전체 예제 모음은 실행하지 않았습니다.

모델 파일 46개의 작업 전후 SHA256이 일치합니다. 실제 실행 결과의 plan·trace·추론 입력 불변성도 검사했습니다. 다른 세션의 기존 작업 파일은 되돌리지 않았습니다.

로그와 해시: [`test-results/relation-condition-composition-2026-11-11`](../../test-results/relation-condition-composition-2026-11-11/).

## 검사 기준 변경 1개

기존 검사:

```js
assert.equal(genericTree.expectationCheck, undefined);
```

새 계약 검사:

```js
assert.equal(genericCheck.expected, 'tree');
assert.equal(genericCheck.assessment, 'satisfied-observed');
assert.ok(genericCheck.candidates.every(c =>
  c.checks.every(check => check.conditionId !== 'bst-order')));
assert.deepEqual(genericCheck.warnings, []);
```

일반 tree에도 위상 검사기를 연결했으므로 검사 결과 부재를 요구하던 계약을 변경했습니다. 해당 소스는 키 값만 잘못 바꾸며 트리 연결은 유지합니다. 따라서 tree는 만족하되 BST 조건은 상속하지 않는 것이 소스에서 도출되는 기대값입니다. 바로 앞의 BST 위반 검사는 그대로 유지했습니다.

첫 통합 검사에서 수동 BST 조회가 키 역할이 없는 부분 연결까지 경쟁 후보로 합쳐 `ambiguous`를 반환하는 문제도 발견했습니다. 기대값 `contradicted`는 바꾸지 않고, 순서 조건을 검사할 후보 범위를 공통 질의에서 수정했습니다.

## 이전 사례의 후보 범위 확인

앞서 만든 `05_rb_color_bits`의 저장된 원본 결과만 조회했습니다. C를 다시 실행하거나 결과를 바꾸지 않았습니다.

| 시점 | 기존 전체 BST 질의 | 선택한 BST 추천의 새 검사 |
| --- | --- | --- |
| P0~P3 | 정확한 후보와 불완전 후보가 섞여 `incomplete` | 네 시점 모두 선택 후보만 `satisfied-observed` |

이는 해당 시점의 **BST 키 순서**에 대한 결과입니다. P1/P2의 RB 조건 위반까지 정상이라는 뜻이 아닙니다. 후보별 결과는 `candidate-scope.json`에 있습니다.

## 남은 범위

- 색·저장 높이 역할의 자동 추론, 모든 자료구조 계열의 새 조건 API 이관은 구현하지 않았습니다.
- 이전 점검의 분리 배열 발견 시점 지연과 공유 종료 노드의 메타데이터 읽기 문제는 기존 관계 추론에 남아 있습니다. 조건 검사기는 그 결과를 임의로 완전하게 만들지 않습니다.
- 현재 추론이 이미 정확히 종료 노드를 구분했다면 그 NIL 색을 검사할 수 있습니다. 모든 실제 NIL 구현을 자동으로 구별한다고 보증하지 않습니다.
- 회전/삽입 작업이 완료된 의미적 경계 추론, UI·색칠·애니메이션은 이번 작업에 포함하지 않았습니다.
