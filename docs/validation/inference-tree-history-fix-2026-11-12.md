# 추론 이력과 관계 근거 보관 수정

2026-11-12. 사용자가 승인한 기존 이력 검사와 두 공통 추론기 오류를 수정했습니다. 중간언어 생성 모델·계측·UI는 변경하지 않았습니다.

읽고 적용한 계약은 `presentation.md`의 모델 경계, `inference-model.md`의 읽기 전용 분리, `structure-composition.md` RC-07, `bst-inference.md`의 원본 관계·검증 근거 보존입니다. 실행 전 기대는 생략 구간 `incomplete`, 완전한 최신 상태는 실제 정상/위반 판정, 실제 수명 종료는 `ended`, 잘못된 근거는 검증 거부입니다.

| 설계 조항 | 변경 위치 | 검증 근거 | 상태 |
|---|---|---|---|
| RC-07 생략과 수명 분리 | `state-history.mjs`, `structure-relations.mjs`, `structure-conditions.mjs` | 한도 1/2/3에서 과거 미생성 상태를 종료로 재사용하지 않음; 실제 종료 유지 | 통과 |
| RC-07 시점별 조회·사용자 지정 | `structure-storage.mjs`, `condition-query.mjs`, `bst-views.mjs` | 표시 상태가 없는 루트 선택, 직접 BST 조회/조건 조회/수동 AVL 지정은 동일하게 불완전; 자동 BST 추천 제외 | 통과 |
| RC-07 표시와 검증 근거 분리 | `history-evidence.mjs`, `bst-contract.mjs` | 포인터와 분리 배열의 정확한 과거 관계 체크포인트 보존; 생략 구간을 채우지 않음 | 통과 |
| 근거 무결성·한도 | `structure-schema.mjs`, `structure-overlay-contract.mjs`, `linked-projection-contract.mjs`, `structure-inference.mjs` | 체크포인트 삭제/미래 시점 변조 거부, 예산 부족은 조건 후보만 제외, 보관 후 결과 검증 | 통과 |
| 올바른 검사 입력 | `ir-structure-composition.test.js`, `ir-inference-tree-history.test.js` | 실제 API 한도로 입력 생성, 기존 `incomplete` 기대 유지; 손상된 새 형식 거부/옛 형식 호환 별도 검사 | 통과 |
| 생성·추론 경계 | 원본 실행 기록 JSON 및 파일 해시 | plan/trace 불변, 모델·계측 52개 파일 SHA-256 동일 | 통과 |

## 검사 기준 변경의 범위

기존 검사는 `omittedStates=1`만 바꾸고 상태를 잘라 시작점이 null인 모순된 새 형식을 만들었습니다. 해당 입력은 손상 거부 검사로 유지하고, 정상 생략 검사는 `inferStructures(plan, trace, {limits:{maxStates:2}})`로 생성합니다. **기대 결과를 정상으로 바꾸지 않았습니다.** 여전히 정보가 없는 시점에서 `incomplete`를 요구합니다.

## 실제 결과

원래 실패 예제의 같은 실행 기록에서 재확인했습니다.

| 한도 | 수정 전 E 시점 | 수정 후 E 시점 | 수정 후 결과 검증 |
|---|---|---|---|
| 1 | `incomplete` | `incomplete` | 통과 |
| 2 | `ended` | `incomplete` | 통과 |
| 3 | `ended` | `incomplete` | 통과 |

별도 포인터 구조체와 분리 인덱스 배열 예제에서도 정상→위반→복구를 먼저 정하고 확인했습니다. 한도 이후의 완전한 최신 상태는 정상 판정을 회복하고, 실제 객체 종료는 종료로 유지합니다. 문자열 키와 기존 구간 집계의 검증용 체크포인트도 관련 검사로 확인했습니다.

- 이력·BST·조건 조합·새 회귀 검사: **24/24 통과**.
- 문자열 키·기존 한도·구간 집계 근거 관련 검사: **5/5 통과**.
- 전체 과거 예제는 재실행하지 않았습니다.

`test-results/history-failure-audit-2026-11-12/`의 `results.json`은 수정 전, `fixed-results.json`은 같은 실행 기록의 수정 후 결과입니다. `fixed-tests.txt`, `related-fixed-tests.txt`에 검사 출력을 보관했습니다.

## 남은 범위

확인한 세 문제는 해결했습니다. 기록 한도로 실제 생략된 시점의 값을 복원하는 기능은 구현하지 않았으며 여전히 `incomplete`입니다. 체크포인트 예산 초과는 별도 진단으로 남습니다. 이번 작업은 UI를 변경하거나 화면 가독성을 검증한 작업이 아닙니다.
