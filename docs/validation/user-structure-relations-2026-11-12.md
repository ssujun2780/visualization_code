# 사용자 지정 관계 API 구현·검증

## 범위와 순서

사용자 지정 관계 정의, 공통 관계 조회, 조건 검사, 기존 표현 설정 연결을 구현했습니다. 구현·문서·검사 코드 작성 후 검증을 실행하고 발견한 문제를 수정했습니다. UI·애니메이션은 작업하지 않았습니다.

읽은 계약: `presentation.md`의 모델 경계, `inference-model.md`, `structure-presentation-policy.md`의 규칙 1~6, `structure-composition.md` RC-01~04 및 시점·수명 계약. 구체화한 API는 `user-structure-relations.md` UR-01~05입니다.

| 설계 조항 | 변경 위치 | 검증 근거 | 남은 항목 |
| --- | --- | --- | --- |
| UR-01 / RC-01 실행 사실과 역할 분리 | `relation-binding.mjs`, `user-relations.mjs`, `index.mjs` | 자동 후보가 없는 실제 C 기록으로 관계 조회. 입력 trace 불변·반환값 격리·실행 범위 검사 | UI 지정 화면 |
| UR-02 저장 방식 공통화 | `relation-binding.mjs`, `user-relations.mjs` | 분리/교차 배열, 구조체 필드, 개별 할당 레코드, 다른 종료값·인덱스 기준, 큰 unsigned 인덱스 | 임의 사용자 실행식과 새 표현 어댑터 |
| UR-03 시점·수명·근거 | `user-relations.mjs` | 과거 조회, 연결 변경·복구, 부분 덮어쓰기, 같은 주소의 새 객체, 해제된 대상, 루트 종료, 조회 한도 | 실행 간/재할당 후 지정 자동 재연결 |
| UR-04 / RC-03 조건 검사 | `condition-query.mjs`, `structure-conditions.mjs`, `structure-relations.mjs` | 순환·공유 자식·잘못된 인덱스 경고, 미관측과 종료 구별, 색 속성 조건 | 임의 사용자 정의 조건은 not-checkable |
| 표현 정책 3~6 | `structure-presentation.mjs` | 수동 우선, 후보 없음, JSON 왕복, 독립 slot, 해제, 새로운 run에서 미적용, 조건을 끈 보기에서도 관계 반환 | 화면·저장 UI |

## 검증 중 발견한 문제와 수정

새로운 관계 API의 기본 검사와 기존 관계·표현 회귀 23개가 먼저 통과했습니다. 이후 경계 검사를 추가하여 다음 세 실패를 재현했습니다. 기대값은 실제 결과에 맞춰 바꾸지 않았습니다.

1. **배열은 살아 있고 루트 슬롯만 수명이 끝났을 때**: `ended`여야 하는 선택이 `contradicted`가 되었습니다. 배열 수명만 기준으로 삼았기 때문입니다. 선택의 루트 슬롯 수명도 확인하도록 고쳤습니다. 다중 루트 일부가 끝난 경우와 모든 루트가 끝난 경우를 구별합니다.
2. **명시적 루트 없는 레코드 관계의 모든 객체가 끝났을 때**: 빈 정상 관계로 판정했습니다. 관측했던 레코드들이 모두 실제 종료되었는지 확인하여 `ended`로 기록합니다. 과거 시점과 현재 빈 루트는 그대로 구별합니다.
3. **기존 속성 조건 조회가 실패한 쓰기를 읽음**: 실패한 쓰기 시도 뒤 색 속성을 0이 아닌 1로 읽었습니다. 공통 `propertiesAt`에서 완료 사건만 읽도록 수정했습니다. 같은 경로의 `initializationEvidence: unobserved` 읽기도 확정값으로 사용하지 않도록 바이트 관측을 무효화했습니다. 중간언어 사건 자체는 변경하지 않았습니다.

역할 선택별 관계 ID를 구별하고, 실제 노드 범위와 맞을 때만 레코드 타입을 연결하며, 조회 사건 ID와 중복 조건 경고도 정리했습니다. 잘못된 연결은 원본 기록 그대로 경고에 남고 C ERROR 사건으로 변환되지 않습니다.

## 실제 C 검증

새 C 소스와 원본 실행 결과, 예상/실제 판정은 `test-results/manual-relations-2026-11-12/`에 저장했습니다.

- `split-relations.c`: 6칸 저장소에서 루트 2, 실제 노드 2→0·5, 0→3. 미사용 1·4는 선택하지 않습니다. 공유 자식 → 순환 → 범위 밖 인덱스 → 빈 루트를 순서대로 검사합니다.
- `heap-relations.c`: 개별 calloc 노드 세 개를 한 레코드 규칙으로 연결합니다. 두 번째 노드 연결 해제, 연결 복구 후 free, 남은 연결 정리, 빈 루트까지 검사합니다.
- `record-relations.c`: 구조체 배열의 두 포인터 필드와 색 속성을 읽습니다. 색 조건 위반을 탐지해도 일반 트리 조건을 오염시키지 않고, 비교 근거 없는 BST 판정을 만들지 않습니다.

바이트 일부 변경·주소 재사용·미관측/실패 관측의 경계는 합성 실행 기록으로 별도 검증했습니다. 이는 실제 C 프로그램을 실행한 검사와 구분합니다.

## 최종 결과

```powershell
node --test tests/ir-user-relations.test.js tests/ir-structure-composition.test.js tests/ir-structure-presentation.test.js tests/ir-inference-tree-history.test.js
```

**28개 통과, 실패 0개.** 전체 예제 모음은 재실행하지 않았습니다. 최초/실패 재현/최종 로그를 각각 `tests-first.log`, `boundaries-first.log`, `tests-final.log`에 보존했습니다.

`model-before.json`과 `model-boundary.json`: 이번 작업 시작/종료 시점의 `scripts/model`, `scripts/instrumentation` 52개 파일 해시가 모두 같습니다. 기존 다른 작업의 변경분도 덮어쓰지 않았습니다.

API·기록 검증 결과이며 화면 가독성·동시 관찰 검증은 아닙니다. 우클릭 메뉴·레이아웃·임의 사용자 조건 실행·새 실행의 매핑 재연결은 구현하지 않았습니다.
