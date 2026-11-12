# 해시 구조 네 가지 보완

## 설계 → 구현 → 근거

공통 추론기만 변경했습니다. 실행 중간언어·UI·애니메이션은 변경하지 않았습니다. 계약은 `docs/design/associative-lookup-inference.md` HASH-01~07과 RC-01~03입니다.

| 기존 보완점 | 변경 위치 | 확인 결과 |
| --- | --- | --- |
| 키·버킷·후보 비교·값 조합 없음 | `associative-views.mjs`, `structure-inference.mjs`, `structure-presentation.mjs` | 포인터/정수 체이닝 및 두 개방 주소법 표현에서 연관 조회 후보 생성. 집계 반례에는 후보 없음. 추천은 부분 근거의 해시 테이블이며 사용자 의도 확정 아님 |
| 삭제 표지·탐사 구별 없음 | `associative-views.mjs`의 상태 동작 근거·탐사 시퀀스 | 02의 A: 1번·3번 슬롯 활성, 2번은 삭제/비활성. B: 2번이 키 22로 재사용되어 활성. 실제 방문 순서 보존 |
| 조기 반환 뒤 기록·다른 버킷 누락 | `record-index-views.mjs`, `indexed-root-views.mjs`, `traversal-boundaries.mjs`, `structure-overlay-contract.mjs` | 04에서 버킷 2의 `[2,1,0]→-1`, 버킷 1의 `[3]→-1`. 다른 초기화/예약 4개 기록을 추가하지 않음 |
| 분리 키/값/표지 및 재해시 대응 없음 | `associative-views.mjs`, `associative-contract.mjs` | 03의 이전/새 저장소 분리 유지. 실제 READ→인자→WRITE로 기존 항목 3개 전달, 새 키 16 별도. 종료된 이전 저장소는 활성 추천에서 제외 |

`queryAssociativeLookup`은 해당 사건 시점에 알려진 상태·탐사·충돌·항목 전달만 반환합니다. 기본 후보 원장은 역사적 근거를 포함하므로 시점별 조회에는 이 API를 사용합니다.

## 집중 검증

- 기존 감사의 고정 중간언어 5개, 총 **2,018사건**을 재사용했습니다. 새 컴파일로 예상 결과를 맞추지 않았습니다. `test-results/hash-structures-fixes-2026-11-11/recheck.mjs`의 키/값·슬롯 상태·루트 순서·종료·재배치 및 입력 불변 검사가 **5/5 통과**했습니다.
- `tests/ir-associative-lookups.test.js`: 헬퍼 함수의 비트 마스크, 키 0, 상태값 5/7/9, 필드 재배치, 동일 값 42, 선형 검색/나머지 집계 반례 **2/2 통과**. 비교 출처·키 값·상태 코드·미래 시점을 변조한 결과를 계약 검사가 거부합니다.
- 관련 기존 검사 **17개 통과**: record-index-contract 2, rooted-connectivity 4, linked-root-collections 4, linked-entry-contract 3, recommendation-scope 4. 전체 예제 재실행은 하지 않았습니다.
- 생성 모델 파일 해시는 시작 시점과 동일합니다. 개수와 결과는 `test-results/hash-structures-fixes-2026-11-11/summary.json`에 있습니다.

## 통과로 처리하지 않은 기존 검사

`tests/ir-record-index-views.test.js`의 4건은 실패를 그대로 남겼습니다. 검사를 바꾸거나 약하게 하지 않았습니다.

1. 세 건은 `traceModel()` 직후 `recordIndexStructures(plan,trace)`만 호출합니다. 현재 `traceModel`은 추론 분리 계약상 선행 배열·컨테이너 후보를 생성하지 않습니다. `recordIndexStructures`가 소비하는 `structures`가 비어 있어 후보 0개가 나옵니다. 호출 도우미의 추론 파이프라인 전환이 별도 필요합니다.
2. 나머지 한 건은 추론 호출 전에 중간언어가 `uninitialized-read`로 종료됩니다. 단일 필드 구조체 값을 인자로 넘기는 기존 반례이며 일반 컴파일 실행은 종료 코드 0입니다. 추론기는 원인이 아니며 생성 모델 수정 권한 범위에서 제외했습니다. 진단은 `legacy-test-diagnostic.json`에 저장했습니다. 근본 원인 전체를 분석한 것으로 주장하지 않습니다.

## 남은 범위

정수 키 중심의 후보 조합입니다. 문자열/복합 키 비교기, 모든 삽입 분산 형태, 관측하지 않은 상태 전이까지 완전 지원하지 않습니다. 저장 슬롯 상태가 확인된 범위만 표시하며, 키의 의미나 재해시 의도를 확정하지 않습니다. 화면 검증은 수행하지 않았습니다.
