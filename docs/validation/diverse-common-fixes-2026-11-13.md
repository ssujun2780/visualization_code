# 다양한 C 사례에서 발견한 공통 경로 10개 보완

2026-11-13. [원래 점검의 A~J](diverse-end-to-end-audit-2026-11-13.md)를 함께 구현한 뒤 관련 사례와 반례를 검사했습니다. 기존 번호 예제 전체는 반복 실행하지 않았습니다. 원래 예상·발견 기록은 유지했습니다.

## 범위와 계약

적용한 계약은 presentation의 생성/추론/표현 경계, inference-model의 시점별 관측 근거, structure-presentation-policy의 미확정/사용자 선택 우선, execution-relations-v2의 쓰기 출처와 불변 입력 검증, prepared-scene PS-05, c-model의 소스 계산/컴파일러 보조 계산 구분입니다. BST KEY-04와 sequence-lookup TR-05에 이번 연결 규칙을 명시했습니다.

이름·예제 번호·정답 숫자로 분기하지 않습니다. 별칭은 기록된 저장소 사슬, 큐는 커서 수명과 실제 접근, 트리/트라이는 관계 역할·비교/문자 사용·슬롯과 종료 근거로 판단합니다. 기존 사용자 지정 우선 규칙과 관측 한도는 유지했습니다.

## 계약 → 구현 → 검증 → 남은 항목

표에서 shared/·inference/·execution-relations/·model/은 scripts/ 아래이며, animation/은 src/animation/ 아래입니다. 같은 행의 후속 파일명은 앞서 표시한 디렉터리를 따릅니다.

| 항목·계약 | 변경한 공통 경로와 방법 | 검증 근거 | 상태·남은 항목 |
| --- | --- | --- | --- |
| A 공유 저장소·실제 쓰기 출처 / PS-05, 실행 관계 | shared/storage-alias.mjs가 부모 상대 offset을 누적하고 범위·순환을 확인합니다. animation/playback.js·memory.js는 별개의 이름/수명을 유지하며 현재 관측 범위를 동기화합니다. execution-relations/v2의 common·provenance·result는 소스 수명을 확인한 뒤 물리 루트 범위로 생산자를 연결합니다. | 이름 있는 구조체 반환·CSR 재생 성공. CSR의 unobserved-memory-producer 58→0. 중첩 별칭·겹침·수명 종료·주소 재사용 반례. | 구현·관련 검사 완료. 주소 숫자가 같다는 이유로 합치지 않습니다. |
| B 유한한 관계 근거 / inference-model | inference/pointer-tree-views.mjs: 배열 슬롯이 실제로 있으면 정수, 없으면 null. undefined×1의 NaN 생성 제거. | LRU5 등 관련 추론의 숫자 근거 유한성, 작업 분석 독립 검증 통과. | 구현 완료. 다이제스트 검사를 약화하지 않았습니다. |
| C 큐 오인식·부분 근거 / 표현 정책 | queue-views.mjs: 관리 변수의 실제 수명 교집합 확인. structure-presentation.mjs: 그 시점까지 설명하지 못한 접근이 있으면 partial을 유지합니다. | 초기화/출력의 서로 다른 순회 변수는 큐가 아님. BFS dist 오추천 제거, 실제 큐 변형과 과거 조회 유지. | 구현 완료. 일부 enqueue/dequeue 증명만으로 전체 배열을 확정하지 않습니다. |
| D 같은 간선의 복수 증명 / inference-model | graph-proof-identity.mjs·traversal-graph-views.mjs·graph-storage-observations.mjs: 끝점과 실제 저장 범위로 간선을 식별하고 supportingProofIds·속성 근거를 합칩니다. | 행렬 8노드·62간선→8노드·21간선. 비자기 13개와 관측 대각선 8개 유지. 다른 저장 슬롯의 실제 평행 간선은 별개. | 구현 완료. 대각선의 의미를 임의로 보정하지 않았습니다. |
| E 발견 시점 / inference-model | array-views.mjs: 정적 배열은 생성 시점, 관측으로 연결한 힙 범위는 실제 타입/범위 근거 시점을 availableAtExecutionId에 저장합니다. 확장·복사·재할당도 해당 근거를 사용합니다. | realloc32·LCS·CSR·LRU의 missing-structure-binding-time 제거. 타입 발견 전후와 재실행 검사. | 구현 완료. 미래 타입을 malloc 시점으로 소급하지 않습니다. |
| F 기본 관계·세부 조건 / 표현 정책, KEY-04, TR-05 | inverse-role-coverage.mjs는 모든 자식 관계와 정확히 대응한 부모 역참조만 보조 역할로 구분합니다. address-selection-controls.mjs와 BST 경로는 실제 같은 포인터 슬롯을 선택한 비교를 연결합니다. sequence-source.mjs·sequence-lookup-views.mjs·sequence-contract.mjs는 기록 배열의 정수 자식 슬롯과 문자 사용·종료 근거를 연결합니다. | 부모 포인터 예제는 BST 자동 선택, 삽입 근거 8개. 희소 트라이의 관측 6노드·5간선과 trie 조건 연결. 비영 루트·미사용 0 슬롯·후속 순환·다른 주소 선택·잘못된 BST 반례. | 구현 완료. 미사용 용량·불명확한 종료는 계속 partial이며 모든 트라이 구현을 보장하지 않습니다. |
| G 반복 전체 탐색 / 근거 보존 | queue-views.mjs: 프레임 종료 색인, 누락 의존성 누적합, 저장소/커서/역할별 접근 재사용. counted-queue-views.mjs: 후보 커서별 접근을 묶고 설명 범위가 안 맞는 조합은 시간선 생성 전에 제외합니다. | 실제 커서/원형 큐 검사 및 정렬 8·16·32 성능 비교. 사건 순서를 유지합니다. | 구현 완료. 한도 확대·사건 삭제로 시간을 줄이지 않았습니다. |
| H 반복 해시 / 불변 입력 검증 | execution-relations/v2/common.mjs: 컨텍스트가 소유한 동결 입력의 다이제스트를 컨텍스트당 재사용합니다. 반환 표는 별도 복사입니다. | LRU3 전후 결과 JSON 해시 동일. 반환 표 변조와 새 입력 컨텍스트 재검증 검사. | 구현 완료. 해시 알고리즘과 의미는 동일합니다. |
| I 준비 이력 중복 / PS-05 | prepared-structures.js에서 완성된 불변 값을 구조 공유하고 prepared-format.js의 prepared-shared-v1으로 Worker·파일을 전달합니다. prepared-state.js·prepared-worker.js·prepare-view-file.mjs에 연결했습니다. | 리스트 8·16·32의 전체 복원 JSON 해시 동일. 32노드 2,242개 준비 항목 유지. 모든 관련 준비 경계·수동 보기·과거 조회 및 기존 형식 검사. | 용량 보완 완료. 준비 시간 단축은 확인되지 않았습니다. 실제 브라우저 가독성/FPS는 미검증. |
| J VLA 보조 계산 / c-model | model/ir-plan.mjs: AST 소스 연산이 없고 LLVM 결과가 동적 alloca의 count에만 쓰이는 사슬을 runtime-allocation-extent로 분류합니다. 원시 관측 ID·할당 소비자는 compilerHelpers에 보존합니다. 실제 sizeof(VLA)는 AST 표현식에 연결합니다. | VLA 원시 사건 812→812, 객체 14→14. 사용자 곱셈·sizeof CALC 유지. 사용자 메모리 효과 동일. | 구현 완료. 공개 사건은 잘못 드러난 컴파일러 CALC 1건만 보조 근거로 이동하여 396→395입니다. |

A의 메모리 동기화는 별칭 없는 일반 READ마다 전체 객체를 검색하지 않도록 실행 기록별 루트/별칭 그룹을 색인합니다. 이전 체크포인트는 변경하지 않습니다. F의 늦게 발견되는 정수 자식 관계는 읽은 슬롯과 연결 사이의 중간 덮어쓰기를 검사하며, 이후 그래프를 과거에 대입하지 않습니다.

## 실행 기록과 검사 결과

- 기존 감사 기록 중 관련 **16개, 65,231개 사건**을 고정 입력으로 추론·독립 검증·상태 재생·준비 복원에 사용했습니다. 각 입력 plan/trace 해시는 전후 동일합니다. 사례별 검사 모두 통과했습니다.
- 관련 자동 검사 이름 기준 **108개 중 107개 통과**, 기존 No12 행 위치 기대 불일치 1개가 남았습니다. 반복 실행한 검사를 중복 합산하지 않았습니다.
- Vite 빌드 통과. 기존 큰 번들 경고는 남습니다.
- 이 결과는 API/상태/준비 데이터 검사입니다. 실제 브라우저 화면의 동시 관찰·배치 가독성·FPS를 검증했다고 주장하지 않습니다.

기존 No12 검사는 마지막 frame.end의 행을 18로 기대하지만, 수정 전과 후 모두 167사건이며 마지막 x167은 i78의 `return 0`(17행)에 연결됩니다. 이번 수정이 만든 변화가 아닙니다. `tests/ir-sizeof-work.test.js:27`의 기준이나 반환 수명 모델을 이 작업에서 바꾸지 않았습니다. 수정 전 ir-plan을 불러 직접 실행한 before-No12.c.json과 수정 후 결과를 보관했습니다.

새 반례 검사의 기준도 변경 이력을 남깁니다. 비영 루트 트라이의 미사용 0 슬롯에 처음 다음 상태 문자열을 강제했습니다.

```js
assert.equal(edge.status, 'active-membership-unknown');
```

이 코드는 루트가 3이고 실제 방문 노드는 3·4·5입니다. 0은 방문한 구성원이 아니므로, 상태 이름보다 소스에서 독립적으로 알 수 있는 아래 사실을 검사하도록 정정했습니다. 제품 추론을 정답으로 복사하지 않았습니다.

```js
assert.deepEqual(snapshot.nodes.map(n => n.index).sort((a,b) => a-b), [3,4,5]);
for (const edge of unusedZeroSlots) {
  assert.equal(edge.to, null);
  assert.equal(edge.terminationExecutionId, null);
  assert.equal(edge.physicalBounds, 'in-bounds');
  assert.ok(!['observed', 'observed-termination', 'inferred'].includes(edge.status));
}
```

같은 검사에서 순환 전 trie 조건 성립, 순환 후 조건 불성립도 유지했습니다. 0을 NULL 종료나 활성 노드로 꾸미면 실패합니다.

## 성능과 크기

수정 전 파일 복사본과 수정 후 모듈에 **같은 실행 기록**을 넣고 별도 프로세스에서 순서대로 측정했습니다. 단일 측정이므로 작은 차이는 잡음일 수 있습니다. RSS는 입력 적재·직렬화 등을 포함한 검사 프로세스의 최고치이며 브라우저 메모리가 아닙니다. MB는 십진, MiB는 이진 단위입니다.

| 추론 대상 | 원소 | 시간 초 전→후 | 최고 RSS MiB 전→후 | 저장 JSON MB 전→후 |
| --- | ---: | ---: | ---: | ---: |
| 버블 정렬 | 8 | 0.264→0.234 | 118.2→122.0 | 0.364→0.364 |
| 버블 정렬 | 16 | 0.745→0.599 | 251.6→264.3 | 1.306→1.306 |
| 버블 정렬 | 32 | 16.680→5.463 | 504.0→414.5 | 5.074→5.074 |
| 합병 정렬 | 8 | 0.891→0.911 | 165.9→162.7 | 1.549→1.519 |
| 합병 정렬 | 16 | 3.612→1.326 | 295.3→301.1 | 5.503→5.445 |
| 합병 정렬 | 32 | 40.802→8.398 | 598.2→515.9 | 21.273→21.159 |

버블32의 기존 추론 상태 한도에 따른 partial은 전후 동일하게 남습니다. 추론 결과 해시는 C~F의 의도한 수정 때문에 달라질 수 있으며, 이를 성능만 바꾼 경우와 혼동하지 않습니다.

| 리스트 준비 | 시간 초 전→후 | 최고 RSS MiB 전→후 | 전달 JSON MB 전→후 | 펼친 결과 해시 |
| ---: | ---: | ---: | ---: | --- |
| 8노드 | 0.111→0.118 | 105.5→89.6 | 0.722→0.188 | 동일 |
| 16노드 | 0.512→0.610 | 154.7→155.1 | 3.031→0.582 | 동일 |
| 32노드 | 4.088→4.417 | 303.7→308.0 | 15.250→2.032 | 동일 |

32노드 전달 크기는 **86.7% 감소**했습니다. 공유 표 구성 비용이 있어 준비 시간 개선은 주장하지 않습니다. 추가 그래프 스냅샷 캐시는 시험했으나 이 사례의 시간 개선이 없고 큰 캐시에서는 메모리도 늘어 최종 구현에서 제외했습니다. 추론/조회 사실을 잘라내는 우회는 하지 않았습니다.

LRU3 작업 관계 분석은 **13.392→8.186초**, 최고 RSS **463.1→464.6MiB**, 결과 **32,368,072바이트와 JSON SHA-256 모두 동일**했습니다. 해시 중복을 줄인 효과이며 전체 작업이 6초 이내라는 뜻은 아닙니다.

## 재현 경로와 남은 항목

- `scripts/experiments/diverse-common-fixes.mjs`: 고정 원본 기록 재검증과 사례별 독립 예상 검사.
- `scripts/experiments/diverse-common-benchmark.mjs`: before/after·단계·사례 지정 측정.
- `tests/diverse-common-contracts.test.js`: 별칭·평행 간선·불완전 역참조·큐 반례·발견 시점·VLA·주소 선택·트라이·시점 조회.
- `test-results/diverse-common-fixes/verification-summary.json`: 중복 제거 검사 집계, 사례별 사건 수와 실패 목록.
- 같은 결과 폴더의 `benchmarks-serial.log`, `benchmarks-final-preparation.log`, `vla-preservation.json`, 사례별 보고서와 원본 보존 파일.

이번 A~J의 구현은 완료했습니다. 기존 No12 검사 계약 정리, 준비 계산 시간의 추가 최적화, 기존 추론 한도, 실제 화면 검증은 별도 남은 항목입니다. 모든 C 문법·자료구조 구현에 대한 완전성을 보장하는 검사는 아닙니다. 다른 세션의 UI 편집은 이 변경의 성과로 포함하지 않습니다.

위 남은 항목의 후속 처리: [No12·준비 성능·한도·실제 화면 검증](diverse-followup-2026-11-13.md). 기존 발견 당시의 수치는 유지합니다.
