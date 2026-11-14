# 그래프 저장 관계의 관측·갱신·추천 보완

## 범위와 계약

2026-11-11. 이전 [그래프 감사](graph-representations-audit-2026-11-11.md)의 네 보완점을 공통 추론기에 반영했습니다. `presentation.md`의 모델 경계, `inference-model.md`의 읽기 전용 계약, `structure-presentation-policy.md`의 근거·범위·사용자 지정 우선 규칙을 적용합니다. 중간언어 생성 모델과 UI는 변경하지 않았습니다.

기존 `expectations.json`과 `control-expectations.json`의 코드 해시·정점 식별자·간선 끝점·중복 개수·속성값을 그대로 검사했습니다. 저장된 실행 기록을 읽어서 추론만 재실행했으며, 전체 예제 모음은 실행하지 않았습니다.

| 설계 요구 | 공통 변경 | 검증 근거 | 상태·제한 |
| --- | --- | --- | --- |
| 비교 생략과 저장소 읽기를 구별 | `graph-storage-observations.mjs`를 index-domain·traversal 경로에서 공용 사용. 선행 비교가 증명한 AST 접근 위치·정점 인덱스 출처·필드 상대 위치·동일 인덱스 속성 역할을 실제 READ에 적용 | 01~04의 `4→2 : 9` 복원. 비교를 생략한 원래 IR 유지. 새 필드 순서·타입 사례의 `3→4 : -5` 확인 | 역할 발견 전의 실행으로 소급하지 않음. 역할 자체를 한 번도 발견하지 못한 경우는 여전히 미확정 |
| 고립 정점과 예약 용량 구별 | 이미 발견한 정점 저장 영역의 실제 인덱스 접근을 별도 구성원 근거로 기록 | 기존 사례의 0~5 포함. 새 사례는 용량 9 중 실제 접근한 0~4만 포함 | 관측된 정점 후보이며 논리적 사용 범위를 확정한 것은 아님. 예약 영역을 초기화한 경우 사용자 의도와 다를 수 있음 |
| 삭제와 관측 부족 구별 | 쓰기 후 미확정을 유지하고, 같은 행의 종료가 확인되거나 확인된 부재 분기를 관측하면 `absent` 기록. 물리 객체와 과거 간선 보존 | 01~04·09의 삭제된 `0→2`가 `absent`. 내부 링크 변경 사례, `break`·`continue`·복합 루프 조건 반례 확인 | 중간 종료·누락된 순회 원소·순회 도중 관련 쓰기로 부재를 확정하지 않음. 복합 종료 조건은 보수적으로 유지 |
| 전체 선택과 부분 후보 구별 | 추천에 `contained-root` 범위 추가. 조건부 상태 WRITE와 다른 정점 영역의 공통 인덱스 READ를 연결해 `conditional-vertex-state` 역할 기록 | 전체 `head`는 graph 우선, 단일 슬롯은 정확한 루트 우선. CSR `seen`은 array 우선, graph 대안 유지 | 알고리즘 이름·방문 완료·최단거리 확정을 뜻하지 않음. 상위 5개와 사용자 지정 우선 유지 |

## 결과와 재현

- 저장된 9개 C 실행, 14개 확인 지점의 정점·가중 간선 비교 통과. 일반 표 음성 대조군에서는 graph 추천 없음.
- 0·음수 속성, 자기 간선, 평행 간선의 개수와 실제 저장 위치 유지. 대칭 간선을 자동 병합하지 않음.
- `tests/ir-graph-storage-observations.test.js`: 이름·필드 순서·타입·용량이 다른 코드, 불완전 순회, 반전된 부재 조건, 조건부 상태 배열, 변조된 증거 거부 검사.
- 기존 관련 11개 검사: 비교·속성·연결 변경·자기 간선·추천 범위·생성/추론 분리. 기존 검사 기준은 변경하지 않음.
- `test-results/graph-relations-fixes-2026-11-11/summary.json`: 사례별 실제 결과와 추천.
- 같은 폴더의 `integrity.json`: 생성 모델 46개 파일 해시 및 입력 계획·실행·보조 관찰 기록 불변 확인.

```powershell
node test-results/graph-relations-fixes-2026-11-11/recheck.mjs
node --test tests/ir-graph-storage-observations.test.js
node --test --test-name-pattern='compressed|linked edge|distinct endpoint|heterogeneous edge|coverage|future|payload overlap|pointer selection|dependency graphs|explicit inference' tests/ir-inference-common-boundaries.test.js tests/ir-inference-common-overlays.test.js tests/ir-recommendation-scope.test.js tests/inference-separation.test.js
```

## 남은 항목

이 변경으로 임의의 그래프 구현 전체를 알아낸다고 보장하지 않습니다. 읽히지 않은 저장소, 최초 역할 근거가 없는 관계, 사용자 의도와 가중치 의미, 복합 조건으로만 종료되는 부분 순회는 여전히 미확정일 수 있습니다. 실제 화면 배치·색칠·애니메이션은 이번에 구현하거나 검사하지 않았습니다.
