# 논리식 입력·부수효과 경계 공통 수정

## 범위와 적용 계약

요청한 CALC 입력 누락을 중간언어 생성 모델에서 수정했습니다. `presentation.md`의 모델/화면 경계, `c-model.md`의 조건식·관찰 의존성, `execution-visualization.md`의 계산 묶음·부수효과·실행 회차 계약을 읽고 적용했습니다. UI와 자료구조 추론기는 수정하지 않았습니다.

| 설계 조항 | 공통 변경 위치 | 검증 근거 | 상태와 남은 항목 |
| --- | --- | --- | --- |
| 한 소스 식의 계산 묶음, 내부 부수효과 분리 | `ir-plan.mjs`의 `groupExpression`: 증가·대입의 값 전달을 부모 식 입력 경계로 처리 | 원본 포인터 삼중 조건, 스칼라 AND/OR의 전위·후위·복합 대입 24조합 | 구현. READ/WRITE 자체를 부모 CALC에 합치지 않음 |
| 내부 작업 완료와 외부 식 완료 구분 | `ir-record.mjs`의 `finishBeforeWrite`: 내부 계산만 완료 후 부모 계산 유지 | 쓰기→부모 결과 순서, 호출과 대입 혼합, 원본 반복 조건 | 구현. 중간 근거는 기존 partialCalculationInputs 사용 |
| AST·LLVM 실제 근거 우선 | `evaluation.mjs`의 논리식 PHI 정규화와 결과 구체화 연결 | 이미 zext로 식별된 결과, guard/반환/대입, AND/OR 혼합, 반복 회차 | 구현. 원본 코드를 새로 해석하거나 C 연산을 재실행하지 않음 |
| 입력 출처·단락 평가 보존 | 기존 `calc-contract.mjs` 유지 | 입력 삭제 24건 거부, NULL 조기 종료, 생략된 READ/WRITE 부재 | 검사 조건을 약화하지 않음 |

## 원인과 수정 전후

원본은 `tests/ir-sequence-lookups.test.js`의 순환 형제 검색입니다.

```c
while(q && q->symbol != *s && steps++ < 3)
    q = q->side;
```

일반 실행과 계측 실행은 `A 1`로 정상 종료했으나, 변환 초안의 `x37`은 표현식 `q&&q->symbol!=*s`에 문자 두 개만 입력으로 넣고 첫 번째 q 읽기 `x32`를 제어 관계에만 남겨 검증에서 거부됐습니다. LLVM에는 내부 A&&B의 독립 결과값 없이 연속 분기와 전체 PHI가 있었고, AST 묶음은 ++ 경계 때문에 내부 식을 별도 완료했습니다.

다른 경로인 `int x=a&&b&&c++<3`도 zext를 통해 PHI를 먼저 식별하면 분기 근거를 보충하지 않아 a·b 입력이 누락됐습니다. 파일명·변수명·입력값에 대한 분기를 추가하지 않고 위 두 공통 경로를 수정했습니다.

새 원본 기록의 첫 전체 조건은 `x40`입니다. q, q->symbol, *s, steps의 기존 0 및 상수 3을 소비하고 참을 반환합니다. 그 전에 `x38` 증가 CALC와 `x39` WRITE가 steps=1을 기록합니다. 다음 전체 조건 `x51`은 문자 비교가 거짓이라 오른쪽을 생략하고 steps를 다시 읽거나 증가시키지 않습니다. 각 조건 평가에 외부 논리식 CALC는 하나입니다.

## 검사 결과

관련 **50개 고유 테스트 통과**. 전체 예제/전체 테스트는 재실행하지 않았습니다.

- `ir-calc-input-contract`, `ir-conditional-flow`, `ir-value-operands`: 17개.
- `ir-evaluation`, `ir-flattened-logical-phi`, `ir-evaluation-ownership`, `ir-sequence-lookups`, 새 `ir-logical-mutations`의 첫 3개: 22개.
- `ir-guard-conditions`, `ir-observation-dependencies`: 10개.
- 새 `ir-logical-mutations`의 포인터 조기 종료 검사: 1개.

새 검사에는 AND/OR × 후위/전위/복합 대입 총 24호출, 혼합 논리식과 실제 함수 호출·대입, 같은 AST의 반복 평가, 관계없는 바깥 guard 입력 제외가 포함됩니다. NULL 포인터, 문자 일치, 다음 포인터가 NULL인 경로, 비교가 거짓이어도 이미 발생한 후위 증가를 각각 검사했습니다. 원본 트라이 반례의 소스·기대 조건은 변경하지 않았고 추론 검사까지 통과했습니다.

단락 평가 결과만 확인한 검사가 아닙니다. 실제 READ 사건 식별자, 증가 전/후 값의 전달자, 쓰기 순서, CALL 횟수, 한 표현식당 CALC 개수, 반복 간 출처 재사용 금지를 확인했습니다. 계산 입력을 삭제하는 24개 변조는 기존 검사기가 거부했습니다.

## 기존 검사 기준 한 곳의 변경

`ir-evaluation.test.js`의 중첩 논리식 검사는 기존에 결과 CALC 11개를 기대했습니다. 소스에는 호출마다 `a&&++x`, `a||++x`, `a&&(b||++x)` 세 식이 있고 함수 호출은 세 번이므로, 합의된 식별 CALC 개수는 **3×3=9**입니다. 기존 11은 실행된 내부 `b||++x`를 두 번 따로 세었습니다.

단순히 실제 개수에 맞추지 않고 다음 검사를 함께 추가했습니다.

```js
assert.equal(logical.length, 9);
// 각 호출의 CALC 소스 식도 정확히 위 세 개여야 합니다.
assert.deepEqual(nested.map(e => e.value.decimal), ['0', '1', '1']);
assert.deepEqual(nested.map(e => e.evaluation.right),
  ['skipped', 'evaluated', 'evaluated']);
assert.deepEqual(nested.slice(1).map(e =>
  e.nestedEvaluations.find(n => n.kind === 'logical').right),
  ['evaluated', 'skipped']);
```

기존 종료값 92, 전위·후위 값, 선택된 삼항식 쓰기, 도움말 표지 개수 등의 검사는 유지했습니다.

## 변경 경계와 근거 위치

수정 전 모델 3개 파일과 검사기 사본, 원본·전위·증가 없는 식·스칼라 재현 결과는 `test-results/logical-boundaries-2026-11-12/`에 보존했습니다. `scripts/inference/*.mjs` 68개 해시는 작업 전과 동일하며 CALC 계약 검사기도 동일합니다.

이 검증은 공통 생성 경로의 수정 근거이며 임의의 모든 C 표현식 지원을 보증하지 않습니다. 화면/애니메이션은 이번 범위 밖입니다. 이전 트라이 감사에서 차단됐던 1건은 해결됐습니다.
