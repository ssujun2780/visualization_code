# 관계 발견 시점과 공유 종료 객체 수정

## 범위와 계약

공통 자료구조 추론기의 두 오류만 수정했습니다. 중간언어 생성 모델, 실행 기록, UI, 자동 색 역할 추론은 변경하지 않았습니다.

읽고 적용한 문서는 `presentation.md`의 모델·추론 경계, `inference-model.md`, `structure-presentation-policy.md`, `tree-inference-projections.md`, `structure-composition.md`의 RC-02·RC-04·RC-07입니다. 기존에 승인된 실행 기록 보존과 시점별 관계 계약을 적용했습니다.

| 계약 | 공통 변경 | 검증 |
| --- | --- | --- |
| RC-07: 해당 시점까지의 증거 | `coindexed-record-views.mjs`: 동일 인덱스 출처의 접근을 시간순으로 보고, 두 배열 이상과 READ를 처음 함께 입증한 증거만 발견 시점에 사용 | 반복 접근, 나중에 추가된 필드, READ 전의 쓰기, 독립 출처, 별칭 반례 |
| 트리 보기: 실제 사용한 연결 역할 | `indexed-root-views.mjs`: 같은 함수의 역할 조합을 관측 접두 집합별로 만들고 가장 이른 완성 근거 선택 | 먼저 시작한 함수가 나중에 양쪽 역할을 갖추더라도, 다른 함수의 앞선 근거를 사용 |
| RC-02: 저장 관계와 논리 관계 분리 | `linked-views.mjs`: 커서의 실제 객체 ID·레코드 오프셋이 스칼라 필드를 읽은 레코드와 일치하는지 확인 | 별도 할당 종료 객체, 같은 할당의 다른 오프셋, 원형 데이터 시작점, 종료 객체의 값 반환 |
| RC-04·RC-07: 값과 모델 보존 | 원본 계획·기록으로 추론만 재실행 | 고정 C 소스 해시, 입력 계획·기록 해시, 생성 모델 46개 파일 해시 불변 |

## 원인과 수정

분리 배열은 한 인덱스 출처에 연결된 모든 접근을 수집한 뒤 마지막 접근 시점으로 발견 시점을 정했습니다. 처음 입증한 뒤의 반복 접근까지 기다리는 오류였습니다. 이제 최초 입증에 필요한 접근들을 기록합니다. 더 늦게 세 번째 배열이 나타나면 두 배열 후보와 세 배열 후보의 시작 시점을 구별하고, 발견 이전 조회에서는 논리 노드를 반환하지 않습니다. A/B와 B/C를 A/B/C로 합치는 추론은 추가하지 않았습니다.

이 수정만으로 기존 AVL의 첫 지점이 해결되지는 않았습니다. 자식 역할을 결합하는 단계에서도 먼저 방문한 함수의 근거를 우선해서, 다른 함수가 이미 두 역할을 입증한 사실을 놓쳤습니다. 이 부분도 같은 공통 시점 규칙으로 수정했습니다. 배열 관계는 `x55`, 양쪽 역할 조합은 `x526`부터 확인되며, 뒤의 함수가 완성하는 `x801`까지 기다리지 않습니다.

공유 종료 객체는 `p->left->color` 같은 읽기를 `p`의 직접 데이터 방문으로 취급했습니다. 이전에는 주소 입력의 출처에 커서가 있기만 하면 충분했습니다. 이제 실제 커서 참조가 읽은 레코드와 일치해야 합니다. 필드명, 색 숫자, 노드 개수로 종료 객체를 예외 처리하지 않습니다. 종료 객체의 물리 노드·자기 연결·READ는 그대로 남습니다.

## 고정 예제의 실제 결과

입력은 `test-results/codex_code-results/balanced-trees-audit-2026-11-11/expectations.json`의 기존 소스 해시와 단계별 예측입니다. 예측이나 생성된 중간언어를 변경하지 않고 저장된 계획·기록에 추론만 다시 적용했습니다.

| 기존 예제·지점 | 이전 결과 | 수정 후 결과 |
| --- | --- | --- |
| `02_avl_soa`, P0 / x765 | BST `not-checkable` | `satisfied-observed`; 키 30·20·10의 실제 슬롯과 간선 일치 |
| 같은 예제, P1 / x2058 | BST `satisfied-observed` | 그대로 유지; 5개 구성원·간선·키 일치 |
| `04_rb_sentinel`, P0·P1·P4 | BST `incomplete` | BST와 명시적 색 연결을 사용한 RB 조건 모두 `satisfied-observed` |
| 같은 예제, P2 | BST `incomplete` | BST는 정상, 빨간 루트의 RB 조건은 `contradicted` |
| 같은 예제, P3 | BST `incomplete` | BST는 정상, 검은 높이 불일치의 RB 조건은 `contradicted` |

총 7개 지점에서 구성원 저장소·슬롯, 간선 양 끝, 키를 고정 예측과 비교했습니다. RB의 색 역할은 원본 구조체의 필드 위치와 인코딩을 명시했습니다. 자동 색 추론 성공으로 해석하지 않습니다.

## 관련 검사와 실패 보존

- 수정 전 새 검사 6개 중 5개에서 오류가 재현됐고, 원형 데이터/종료 데이터 반환 반례는 통과했습니다. 원래 6개의 기대값은 유지했습니다.
- 추가한 함수 간 발견 시점 검사까지 새 검사 7개는 통과했습니다. 추가 검사 작성 중 처음에는 왼쪽 비교만 실행한 입력에 BST 전체 판정을 요구했습니다. 그 입력의 실제 결과는 오른쪽 방향 근거가 없어 `incomplete`였고, 관계 구성원·두 간선 자체는 정상이었습니다. 전체 BST 성공 기대를 낮추는 대신 입력에 별도 함수의 오른쪽 비교를 추가했습니다. 기존 고정 예제·기대값은 수정하지 않았습니다. 첫 입력의 관측은 `role-repro.json`에 보존했습니다.
- 관련 8개 파일의 검사 **50개 중 49개 통과, 1개 실패**. 추가 기존 payload 소비 검사 1개 통과. 합계 **51개 중 50개 통과, 1개 실패**입니다. 전체 예제 묶음은 실행하지 않았습니다.
- 남은 실패: `ir-linked-views.test.js`의 단일 포인터 필드 검사. `N **s=&a->q; *s=0;`의 필드를 길이 1 배열로 추가합니다. 이번에 수정한 세 추론 모듈을 전혀 실행하지 않고, 기존 `bindArrayStructures`와 `arrayStructures`만 호출해 같은 잘못된 배열을 재현했습니다. 배열 생성 단계의 별도 문제로 기록했으며 검사나 해당 구현은 변경하지 않았습니다.
- 중간언어 생성 모델 46개 파일의 시작/종료 SHA-256은 모두 같았습니다. UI 검사는 범위 밖입니다.

검사 명령:

```text
node --test tests/ir-relation-discovery-boundary.test.js tests/ir-inference-relations.test.js tests/ir-inference-common-boundaries.test.js tests/ir-recommendation-scope.test.js tests/ir-linked-views.test.js tests/ir-linked-entry-contract.test.js tests/ir-structure-composition.test.js tests/inference-separation.test.js
node --test --test-name-pattern="payload consumption" tests/ir-structure-diversity-fixes.test.js
node test-results/relation-boundary-fixes-2026-11-11/recheck.mjs
```

결과는 `test-results/relation-boundary-fixes-2026-11-11/`의 `before.log`, `related.log`, `payload.log`, `recheck.json`, `unrelated-array-failure.json`, `model-integrity.json`에 있습니다.

## 남은 한계

커서가 종료 객체를 직접 가리킨 채 스칼라 필드를 소비하면 여전히 데이터 소비로 보수적으로 처리합니다. 필드가 관리 정보인지 실제 페이로드인지 모든 사용 방식의 의도를 자동 판별한 것은 아닙니다. 관측되지 않은 연결·색·비교 역할을 보충하지 않으며, 초기화·동일 크기·동일 숫자만으로 배열 관계를 확정하지 않습니다.

후속 작업에서 위의 단일 포인터 필드 배열 오인식을 수정했습니다. 당시의 검사 결과는 이력으로 유지하며, 변경과 재검증은 [별도 수정 기록](scalar-field-array-fix-2026-11-11.md)에 있습니다.
