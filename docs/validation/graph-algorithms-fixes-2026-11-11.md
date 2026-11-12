# 그래프 알고리즘 추론 보완 결과

기존 감사에서 찾은 6개 보완점을 공통 추론기에 적용했습니다. 중간언어 생성 모델·UI·기존 예상 파일은 변경하지 않았습니다. 입력 그래프/선택 간선/DSU 자동 합성은 당시 구분한 별도 확장으로 남습니다.

읽은 계약은 `presentation.md`, `inference-model.md`, `structure-presentation-policy.md` 적용 규칙 1~6입니다. [공통 관측 계약](../design/graph-worklist-relations.md)에 이번 규칙을 명시했습니다.

| 조항 | 공통 변경 | 확인 근거 | 한계 |
| --- | --- | --- | --- |
| 근거 식별 | `graph-proof-identity`, `graph-storage-observations`, `graph-storage-contract` | 크루스칼의 같은 CALC/다른 READ 근거를 구별. 다른 근거 ID로 변조하면 검증 실패 | 입력 그래프/MST 합성은 별도 |
| 인접 발견 | `neighborhood-proofs`, `traversal-graph-views`, `structure-overlay-contract` | 행렬 BFS 실제 2간선, 개수 기반 DAG 6간선 정확. 미사용 열·빈 행·반례 검사 | 읽지 않은 간선은 복원하지 않음 |
| 역할/추천 | `traversal-graph-views`, `structure-presentation` | CSR 원래 5간선은 graph 우선, 완료 상태는 array 우선. 3간선 작업 관계는 보존 | 완료 의미를 자동 확정하지 않음 |
| 원형 큐 | `counted-queue-views`, `queue-views`, 계약 검증 | 별도 개수·함수 분리·시작 위치 2·경계 순환·중복 값. 삽입 WRITE 식별자와 FIFO 순서 검증 | 현재 증거 형식 밖의 큐까지 보장하지 않음 |
| COPY 연결 | `copy-index-evidence`, `index-relations` | 실제 GEP에서 누락된 기준 인덱스를 보완. 내부 포인터 배열의 좌표 오인식 차단 | 보조 LLVM 관찰 필요; 임의 주소 표현 지원 아님 |
| 레코드 순서 | `index-relations`, `embedded-array-views`, `array-container-history`, 스키마/추천 | 두 번째 필드를 키로 쓰는 최대 힙의 5개 점유 원소와 순서 조건. 원소 필드 접근을 소수 인덱스로 보던 경계 수정 | 정수 단일 필드 조건; 복합 비교는 별도 |

## 실행한 검사

- 새 변형·반례 6개와 기존 관련 회귀 20개: **26/26 통과**. 기존 검사 기대값은 변경하지 않았습니다.
- 원래 그래프 7건의 저장된 중간언어를 재추론: **7/7 완료**. 원래 예상 파일의 정점/간선/가중치/상태와 대조했습니다. 포인터 DFS와 히스토그램 반례도 유지했습니다.
- 크루스칼의 추론 상태는 `partial`에서 `completed`로 바뀌었습니다. 잘못된 관계 근거 ID를 넣으면 여전히 검증에 실패합니다.
- 원래 실행 사건 **3,704개**, 계획·실행·관찰 입력은 그대로입니다. 생성 모델 46개 파일의 작업 시작 해시와 일치합니다.
- 전체 예제 모음은 재실행하지 않았습니다. 화면 검증은 수행하지 않았습니다.

```powershell
node --test tests/ir-graph-algorithm-relations.test.js tests/ir-graph-storage-observations.test.js tests/ir-index-relations.test.js tests/ir-queue-views.test.js tests/ir-array-containers.test.js
node test-results/graph-algorithms-fixes-2026-11-11/recheck.mjs
node test-results/graph-algorithms-fixes-2026-11-11/verify.mjs
```

저장 결과: `test-results/graph-algorithms-fixes-2026-11-11/`. `summary.json`은 실제 추론, `verification.json`은 고정 예상 대조 결과입니다. 테스트 소스에서 C 문자열 줄바꿈을 잘못 이스케이프했던 작성 오류만 수정했으며 기대 출력·관계·검사 조건은 완화하지 않았습니다.
