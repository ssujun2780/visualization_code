# 새 C 알고리즘 검증 예제

2026-11-05 약 30분 검증 작업용입니다. 기존 No1~No46은 재실행하지 않았습니다. 이 폴더는 요청한 단수 경로 `example/c/codex_code`입니다.

26개 소스, 65개 입력 조합입니다. 삽입/합병/선택 정렬, 포인터·인덱스 연결 리스트, 원형 이중 연결 리스트, 포인터·인덱스 BST, 세 가지 다익스트라 표현, Prim, Kruskal/DSU, 두 가지 격자 BFS, 비트셋 도달성, 영속 세그먼트 트리, Fenwick, 비효율적 동적 배열, 공유 DAG, Tarjan SCC, 행별 할당 LCS를 포함합니다. 24~26은 같은 의미를 다른 문법/줄 배치로 표현한 대조군입니다.

- `16_persistent_segment_tree.c`, `21_tarjan_components.c`: 정돈된 복잡한 구현입니다.
- `01_insertion_beginner.c`, `14_grid_matrix_queue.c`: 짧고 직접적인 구현입니다.
- `11_prim_spaghetti.c`, `22_lcs_scattered_grid.c`: goto·수동 상태 관리·분산 할당을 사용합니다.
- `03_heap_list_slow.c`, `18_vector_reallocate_slow.c`: 불필요한 순회·복사·재할당을 의도적으로 남겼습니다.
- `19_false_tree_names.c`, `20_shared_dag.c`: 오추론을 확인하는 대조군입니다.

`cases.json`에 입력, 실행 전에 계산한 출력·일부 대입 값 순서·호출 횟수·자료구조 의도를 저장했습니다. `make-cases.mjs`의 JS 기준 계산은 중간언어 생성 모델을 사용하지 않습니다. 다익스트라 출력은 Bellman–Ford, Prim 출력은 Kruskal, SCC는 상호 도달성, LCS 출력은 부분수열 전수조사, 영속 트리는 배열 버전 복사로 계산합니다. 과정의 순서가 필요한 검사는 별도 JS 시뮬레이션을 사용합니다.

프로젝트 루트에서 특정 예제만 다시 실행할 수 있습니다.

```powershell
node example/c/codex_code/run-suite.mjs 16_persistent_segment_tree
node example/c/codex_code/run-one.mjs 05_circular_sentinel input0
node example/c/codex_code/summarize.mjs
```

결과: `test-results/codex_code-results/<예제>/<입력>/`.

- `prediction.json`: 실행 전에 저장한 예측과 소스 SHA256.
- `original.c`, `stdin.txt`: 실제 사용한 소스와 입력.
- `native-O0.*`, `native-O2.*`: GCC C11 엄격 경고 빌드와 실행 결과.
- `plain-wasm.*`: 계측 없는 실제 Clang/WASM 결과.
- `plan.json`, `trace.json`: API 중간언어 정의와 실행. API가 예외로 거부한 경우에는 반환되지 않습니다.
- `observations.*`, `original.ast.txt`, `original.ll`: API가 정상 반환한 경우의 관찰 및 컴파일러 자료.
- `writes-*.json`: 미리 예측한 대입 순서와 비교한 이벤트.
- `structures-summary.json`, `report.json`: 자료구조 후보와 검사 결과.
- `exception.txt`: 중간언어 생성기 내부 예외. 입력 C의 오류와 구분합니다.
- `attempts/`: 도구 준비·예제 서식 수정 등 이전 시도. 최종 통계는 최상위 report만 집계합니다.

GCC와 Node가 PATH에 필요합니다. Windows 출력의 CRLF만 비교할 때 정규화하며 원문은 보존합니다. 모든 테스트 입력은 자료구조 용량·산술 범위 내로 제한했습니다. 네이티브 O0/O2 및 계측 없는 WASM에서 결과를 검증했습니다. 현재 MinGW에는 UBSan 런타임이 없어 sanitizer 검증은 수행하지 못했습니다. 이 결과는 임의의 모든 입력에 대한 무오류 증명이 아닙니다.

모델은 이 작업에서 수정하지 않았습니다. 보완 사항은 결과 폴더의 `IMPROVEMENTS.md`에 모았습니다. 애니메이션 렌더러는 검증 대상이 아니며, 중간언어의 과정이 주 대상입니다.
