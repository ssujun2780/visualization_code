# 제한된 추론 이력의 중간 구간 조회 수정

2026-11-12. 완료 감사의 E 묶음 중 **트라이·연관 조회에서 생략된 중간 상태를 정상 상태로 재사용하던 한 문제**를 수정했습니다. E 전체나 다른 7개 묶음의 완료를 뜻하지 않습니다.

## 범위와 적용 계약

- 사용자 승인: 남은 항목 중 쉽고 짧은 구현 하나를 선택해 공통 경로에 적용.
- 읽은 계약: presentation, inference-model, 표현 정책 1–6, RC-06/07, TR-04/05, HASH-07, 설계 대응표 템플릿.
- 중간언어 생성·계측·UI 및 다른 세션의 실행 관계 추론기는 변경하지 않았습니다.
- 입력·기대: 단어 종료 표지가 1→0→1인 두 저장/접근 형태와 해시 값 7→9→11. 생략된 중간 시점은 확인 불가, 보관된 앞부분과 최신 시점은 정상 조회. 상태 예산 1/2/접두 보존/무생략, 잘못된 사건과 변조된 구간도 검사.

| 설계 조항 | 변경 위치 | 검증 근거 | 상태·남은 항목 |
| --- | --- | --- | --- |
| RC-07, TR-04/05, HASH-07 | `scripts/inference/state-history.mjs`; `sequence-lookup-views.mjs`, `associative-views.mjs` | 최초 생략 사건·생략 수, 구간 시작 포함/끝 제외, 한도 1에서 state=null, 최신 상태 복원 | 두 생성기의 동일 원인 수정. 다른 계열의 한도 생성기는 이번 이관 대상 아님 |
| RC-06/07, 표현 정책 | `structure-relations.mjs`, `structure-presentation.mjs`, `storage-semantics.mjs` | 생략 구간의 관계 incomplete, 조건 incomplete, 자동 추천 제외, 수동 tree 유지 | 해당 공통 소비 경로 적용 |
| RC-07, 입력 불변 | `sequence-contract.mjs`, `associative-contract.mjs` | 구간·한도 변조 거부, 조회 결과 변경 시 저장 결과 불변, 생성/추론 분리 검사 | 생성·계측 52개 파일 해시 불변 |

## 실제 재현 전후

이전 감사의 저장 실행을 그대로 사용했습니다. 원본 파일과 당시 결과를 덮어쓰지 않았습니다.

| 조회 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 트라이 상태 한도 2, 사건 x54 | x51 상태 반환, 생략 표시 없음 | x51은 이전 참고 상태로 유지, `historyGap:true`, `status:incomplete` |
| 90개 상태의 저장 | 생략 구간 정보 없음 | 2개 보관, 88개 생략, 최초 생략 x54 명시 |
| 최신 보관 상태 | 과거 생략 때문에 최신 상태에도 historyGap | 실제 최신 상태의 자체 근거로 판정 |

근거: `test-results/inference-history-gap-2026-11-12/audit-reproduction.json`, `integrity.json`.

## 관련 검사

- `node --test tests/ir-inference-history-gap.test.js tests/ir-associative-lookups.test.js tests/ir-structure-composition.test.js tests/ir-structure-presentation.test.js tests/inference-separation.test.js`: **31 통과, 별도 기존 문제 TODO 1개**.
- `node --test tests/ir-sequence-lookups.test.js`: **5 통과**.
- 과거 예제 전체를 재실행하지 않았습니다. 새 회귀는 파일명·식별자·특정 값으로 제품 코드가 분기하지 않으며, 관측 사건 위치로 생략 구간을 결정합니다.

## 별도 발견: 포인터로 문자를 읽는 트라이의 라벨 누락

후속 상태: 아래 당시 실패는 같은 날 [슬롯 라벨 연결 수정](sequence-label-binding-2026-11-12.md)으로 해결했습니다. 기대값은 유지하고 TODO를 해제했습니다.

처음 작성한 검사는 최신 상태에서 트라이 추천까지 복구되는 것을 요구했습니다. 아래 입력 소비 형태는 **이력 한도를 걸지 않은 결과부터** 간선 라벨이 없어 추천되지 않았습니다.

```c
while (*s) {
    int k = *s - '0';
    if (!p->c[k]) return 0;
    p = p->c[k];
    s++;
}
return p->end;
```

실제 무한도 결과는 `tree:satisfied-observed`, `labelled:incomplete`, `trie:not-established`입니다. 이 문제의 정확한 원인은 이번 범위에서 확정하지 않았으며, 이력 수정 완료로 감추지 않습니다.

추천 기대값을 false로 바꾸지 않았습니다. 원래 추천 요구를 독립된 **실패하는 TODO 검사**로 보존했고 통과 수에서 제외했습니다. 해당 코드의 이력 조회 검사는 계속 실행됩니다. 별도로 라벨 근거가 확인되는 인덱스 입력 형태와 해시에서 생략 구간 추천 차단 및 최신 상태 추천 복원을 검사했습니다.

화면 검증은 수행하지 않았습니다. 이번 변경은 추론 데이터와 조회·추천 계약의 수정입니다.
