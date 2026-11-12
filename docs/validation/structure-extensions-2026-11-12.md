# 추론 확장 다섯 범위 검증

## 작업 범위와 계약

- 요청: 남은 저장 표현·관리 역할·비교/집계·지연 갱신/공유·구조 간 관계를 확인하면서 공통 추론기를 수정.
- 제외: 중간언어 생성 모델, 애니메이션 및 UI.
- 읽고 적용한 문서: `presentation.md`, `inference-model.md`, `structure-presentation-policy.md`, `structure-composition.md` RC-01~07, `priority-partition-range-inference.md`, `bst-inference.md`, `execution-relations.md`의 원본 사실·시점·의도 구분.
- 구현 계약: [EXT-01~07](../design/structure-extensions.md). 색 의미·영속성·알고리즘 최적성은 구현 완료로 주장하지 않습니다.
- 최초 13개 입력의 예상 출력·관계·소스 해시는 실행 전에 `test-results/structure-extensions-2026-11-12/expected.json`에 고정했습니다. 변형 7개도 실행 전에 개별 expected.json을 작성했습니다. 변수명·파일명·특정 정답을 생산 코드 분기에 사용하지 않습니다.

| 계약 | 공통 변경 위치 | 코드·실제 결과의 검증 근거 | 상태와 경계 |
| --- | --- | --- | --- |
| EXT-01 대표 | `pointer-semantics.mjs`, `record-evidence.mjs` | `y->p=x`와 `x->p=find(x->p)`의 반환 출처. 구성원 `[0,1,2,3]`, `[4]`, 병합 3회·압축 1회 및 `3→2→0` 이전 경로. calloc 변형도 동일 | 구현. 임의 종료 규약은 미확정 |
| EXT-01 우선순위 | `priority-comparison.mjs` | skew heap의 현재 루트 도달 노드 4→0. 제거된 노드는 저장소에서 삭제하지 않음. unsigned 값 4294967295를 음수로 바꾸지 않음 | 구현. 힙 세부 종류는 미확정 |
| EXT-02 복합키 | `record-evidence.mjs`, `priority-comparison.mjs` | `before(E x,E y)`의 값 복사 출처. 첫 필드 오름차순·동률 두 번째 내림차순, 반대 방향 변형, 원래 순서 `2:9 2:5 3:7 4:1`. 패리티 비교자는 사전식 순서로 오인하지 않음 | 관측 경로 구현. 임의 비교자 실행 없음 |
| EXT-02 집계 | `selection-evidence.mjs`, `range-aggregate-views.mjs` | 함수 호출 min 및 inline max. 루트의 두 자식 2·3과 `[0,4)` 유지. min -2→-7, max 8 | 구현. 모든 사용자 정의 집계 지원 아님 |
| EXT-03 역할 | `management-roles.mjs`, `condition-query.mjs` | 높이/색 후보 offset 4, 무관한 cache/flag offset 8 배제. 포인터 rank offset 8. 분리된 rank/size 배열을 대표 반환 출처로 연결하고 무관한 counter 배제. 사용자 지정 높이 필드가 자동값보다 우선 | 높이 자동 조건 연결. 색 해석은 `mapping:null` |
| EXT-04 갱신 | `composed-update-views.mjs`, `range-aggregate-views.mjs` | `v[k]+=(r-l)*d; pending[k]+=d;` 적용 5회. 부모 1→자식 2·3, 부모 3→자식 6·7 전파 2회. 루트 30 시점에 자식 값은 실제 3·7로 유지. 최종 태그 `[0,5,0,5,5]`, 잎 값 9 | 구현. 전파 없는 반례는 coupled-update로 유지 |
| EXT-05 공유 | `pointer-semantics.mjs` | 경로 복사 뒤 공유 범위 offset 24·48·60·72, 두 루트의 독점 노드 각 3개. 같은 모양의 독립 트리는 공유 후보 없음 | 공유 사실 구현. 영속성 증명 아님 |
| EXT-06 관계 | `composed-update-views.mjs` | 원본 레코드 0·1·2→선택 위치 0·1·2, 실제 끝점 필드와 대표 병합 연결. 단순 복사 반례는 후보 없음 | 복사 이력 구현. MST 이름/최적성 확정 없음 |
| EXT-07 계약 | `extension-contract.mjs`, `semantic-contract.mjs`, `structure-presentation.mjs` | 구성원·공유 노드·복사 오프셋·태그 값·자식 연결을 변조하면 거부. 발견 전 조회 null, 사용자 고정 우선, 추천 ≤5 | API 검증. UI 미변경·화면 미검증 |

## 검증 결과

- 새 C 코드 **20개 정상 실행**, 각 소스에서 먼저 정한 출력과 일치.
- 관련 7개 테스트 파일의 **61개 검사 통과**. 기존 예제 전체를 재실행하지 않았습니다.
- 최초 13개 고정 예상값·관계·소스 해시 불일치 **0개**.
- 추론 호출 전후 입력 계획·실행 기록 해시 동일. 작업 시작 때 기록한 `scripts/model` **46개 파일의 해시도 동일**합니다. 기존 작업트리의 다른 변경을 되돌리거나 이번 변경으로 취급하지 않았습니다.
- 추가 회귀: 방향 반전, 동적 저장소, 필드명·색 코드 변경, 분리 관리 배열, 미지원 비교 정책, 미전파 갱신, unsigned 경계.

검사 중 발견한 검증기 문제도 수정했습니다. 저장된 자식 목록의 기존 원소만 검사하던 방식은 누락을 잡지 못했습니다. 현재는 실제 읽기와 직전 쓰기로 기대 자식 목록을 재구성해 누락·추가를 검사합니다. 해당 실패 검사는 그대로 유지했습니다.

필드명 변경용 테스트 소스에서 `->c`만 변경하고 `.c`를 남겨 한 번 컴파일이 실패했습니다. 모든 동일 식별자 접근을 변경하도록 테스트 소스를 수정했으며, 예상 출력과 관계 기준은 바꾸지 않았습니다. 실패 기록은 `colour-renamed.fixture-error.execution.json`으로 보존했습니다.

## 재현 자료

- C 코드: `example/c/codex_code/structure_extensions_20261112/`
- 최초 비교: `scripts/experiments/structure-extensions-audit.mjs`, `tests/fixtures/structure-extensions.mjs`
- 검사: `tests/ir-structure-extensions.test.js`
- 원본 실행·추론·고정 예상값·검사 로그: `test-results/structure-extensions-2026-11-12/`
- 최종 검사 로그: `focused-tests.txt`, 불변성 확인: `verification.json`

남은 지원 경계는 EXT-07에 명시했습니다. 코드/API 통과를 화면 가독성이나 모든 구현 방식의 완전한 자동 판별로 해석하지 않습니다.
