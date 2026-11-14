# 트라이 라벨과 실제 포인터 슬롯 연결 수정

2026-11-12. 라벨 연결과 그 검증만 수정했습니다. 중간언어 생성·계측, UI, 다른 추론 기능은 변경하지 않았습니다.

읽은 계약: presentation, inference-model의 분리 경계, 표현 정책, TR-01~04. 실제 입력 문자와 접근한 자식 슬롯을 연결하고 미래 근거·다른 노드의 문자를 섞지 않는 규칙을 적용했습니다.

| 조항 | 변경 위치 | 검증 근거 | 남은 범위 |
| --- | --- | --- | --- |
| TR-03 입력→선택 슬롯 | `sequence-lookup-views.mjs` | 과거 첫 간선 대신 접근 당시 최신 관측 사용. 실제 슬롯 범위·간선 ID·대상 노드·관측 사건 보존 | 비교 함수 등 다른 라벨 추론 방식의 확장 없음 |
| TR-01/02 관계 보존 | 같은 파일의 라벨 부착 경로 | 같은 번호의 슬롯이라도 다른 노드에서는 a/x 분리. 재연결 직후 라벨 없음, 새 접근 후 a 부착 | 원래 노드·간선·실행 사건 변경 없음 |
| TR-03/04 근거 검사 | `sequence-contract.mjs` | 슬롯 범위, 대상, 간선 ID, 미래 관측, 다른 간선의 라벨을 서로 바꾼 변조 모두 거부 | 라벨 근거와 실제 슬롯의 대응 검사 |
| 기존 누락 회귀 | `ir-inference-history-gap.test.js` | 기존 추천 기대값 그대로 통과, TODO 제거, 모든 입력 형태에서 최신 추천 검사 실행 | 이력 수정 당시 별도 기록한 라벨 문제 해결 |

기존에는 입력 근거의 `field:...`와 현재 간선의 `field:...:slot:0`을 문자열로 비교해 라벨을 버렸습니다. 수정 후에는 실제 슬롯 정체성으로 연결합니다. 필드 이름 정규화는 역할 일치 확인에만 사용하며 슬롯·노드 구분을 대체하지 않습니다.

새 검사 `ir-sequence-label-binding.test.js`는 노드별 문자 변환을 사용합니다. root의 child[0]은 a, 다음 노드의 child[0]은 x입니다. 연결을 root→새 노드로 바꾸면 과거 라벨이 사라지고, 실제 새 입력 접근 후에만 다시 붙습니다. 기대 구성원·연결·문자는 C 코드로 먼저 정했고 수정 전 라벨 누락 실패를 확인했습니다.

관련 검사:

```text
node --test tests/ir-sequence-label-binding.test.js tests/ir-inference-history-gap.test.js tests/ir-sequence-lookups.test.js
```

14개 통과, 실패·TODO 없음. 저장된 기존 감사 실행의 문자는 0/1로 각각 복구되고 `labelled:satisfied-observed`, `trie:supported-observed`가 됩니다. 근거와 파일 무변경 확인은 `test-results/sequence-label-binding-2026-11-12/`에 기록합니다. 화면 검증과 다른 예제 전체 재실행은 수행하지 않았습니다.
