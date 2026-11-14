# 배열 추론 점검: 관리 변수·사용 범위·논리적 순서

2026-11-10. 구현은 수정하지 않았습니다. 중간언어 생성·계측·추론 코드 전부 작업 시작 해시와 동일합니다. 새 예제와 검사 스크립트·결과만 추가했습니다. 배열 선언·자료형·물리 크기 자체는 추론 성과에서 제외합니다.

## 방법

- 예제 7개의 코드와 `predictions.json`을 먼저 저장하고 API를 실행했습니다. 결과를 보고 예측을 바꾸지 않았습니다.
- 일괄 추가의 원인을 구분하는 대조 예제 1개를 추가했습니다. 별도 `bulk-control-prediction.json`을 실행 전에 저장했으며 최초 예측 파일은 그대로 유지했습니다.
- `traceModel`로 컴파일·실행한 뒤 출력 시점의 실제 추론 상태를 추출했습니다. 종료 후 최종 객체 상태를 출력 시점의 수명으로 오인하지 않도록 사건 순서로 조회했습니다.
- 저장된 plan/trace로 `inferStructures`도 재계산해 입력이 변경되지 않는지 확인했습니다.
- 전체 예제나 전체 테스트 묶음은 실행하지 않았습니다. 새 관련 코드 8개만 실행했습니다.

코드: `example/c/codex_code/array-inference-audit-2026-11-10/`

결과: `test-results/codex_code-results/array-inference-audit-2026-11-10/`

## 예상과 실제 결과

모든 코드가 예상 stdout·종료 코드 0으로 정상 완료됐습니다. 중간언어 누락 목록과 설명되지 않은 관찰 목록은 비어 있고, 추론도 완료됐습니다. 이것을 추론 내용 전체의 정답 판정으로 사용하지 않았습니다.

| 예제 | 코드에서 먼저 정한 기대 | 출력 시점의 실제 추론 |
|---|---|---|
| `01_embedded_prefix.c` | `b.cell`과 `b.used` 연결. 6칸 중 `[0,1]` 사용, 순서 `[0,1]` | 연결·길이 2·순서·비활성 `[2,3,4,5]` 일치. 지운 원소 33의 실제 바이트는 유지 |
| `02_pointer_prefix.c` | `b.base`가 가리키는 저장소와 `b.used`, `b.limit` 연결. 6칸 중 `[0,1]` | `dynamic-array`가 관리 필드를, `array-structure`가 길이·순서를 제공. 결과 모두 일치 |
| `03_separate_growth.c` | 별도 전역 `storage/amount/bound`. 용량 3→6, 최종 길이 3, 순서 `[0,1,2]` | 관리 변수와 두 할당은 연결됨. 하지만 실제 배열 보기의 길이·논리적 순서·비활성 범위는 null |
| `04_bulk_prefix.c` | `memcpy`로 3개 추가 후 길이 감소. 길이 2, 순서 `[0,1]` | 물리 배열만 남고 관리 길이·용량 역할과 사용 범위·순서는 미확정 |
| `05_scan_only.c` | 8칸 중 3칸을 읽었을 뿐. 사용량 3이나 뒤 5칸 비활성을 확정하면 안 됨 | 그 오인식은 없음. 다만 반복 변수 소멸 뒤 배열 후보의 `active`가 false가 됨. 실제 배열은 여전히 살아 있음 |
| `06_ring.c` | `head=2,count=4`: 순서 `[2,3,4,0]`, 비활성 `[1]`. 비운 뒤 순서 `[]` | 두 시점의 관리 변수·사용 범위·순서 모두 일치. 물리 5칸과 잔존 값 보존 |
| `07_sparse.c` | 점유 표시가 참인 `[4,5]`만 사용. `count=2`를 앞 2칸으로 해석하면 안 됨. 논리 순서는 미확정 | 두 배열의 같은 인덱스 대응은 찾음. 점유 표시 역할·사용 집합·count 역할은 못 찾음. 거짓 접두 범위나 순서는 만들지 않음 |
| `08_bulk_with_take.c` | 04의 제거를 02와 동일한 `take()`로 교체. 기대 길이·순서는 그대로 | 제거 1건은 찾았지만 묶음 삽입은 못 찾아 여전히 관리 역할·순서가 미확정 |

01·02의 `logicalOrder=[0,1]`은 저장된 원소의 논리적 열거 순서입니다. LIFO로 꺼내는 순서와 구분합니다. 07의 사용 집합 `[4,5]`는 정렬된 표기일 뿐, 삽입 순서나 제거 순서를 부여한 것이 아닙니다.

## 현재 처리 경로

`array-views.mjs`와 `separate-array-views.mjs`는 AST의 인덱스·비교·할당 관계와 실제 포인터·관리 변수 값을 연결합니다. `embedded-array-views.mjs`는 저장소 내 접근과 관리 변수 갱신을 묶어 삽입·제거 근거를 찾고, 확인된 역할에 따라 `logicalOrder`와 `inactiveRanges`를 생성합니다. 이름에 `used`, `head`가 있다는 이유로 역할을 부여하지 않습니다.

01에서는 실제 `b.cell` 필드가 객체 `o4`의 offset 4, 관리 변수 `b.used`가 offset 28입니다. `x81` 출력 시점에 길이 2와 다음 결과가 있습니다.

```json
{"status":"consistent","length":2,"capacity":6,
 "logicalOrder":{"start":0,"count":2,"modulus":6,"direction":1},
 "inactiveRanges":[{"objectId":"o4","offset":12,"size":16}]}
```

06의 `x197`에서는 head 2, length 4, modulus 5이므로 `[2,3,4,0]`입니다. `x336`에서는 length 0이고 전체 20바이트가 논리적 비활성 범위입니다. 중간언어에서 메모리를 지우거나 별도 객체를 생성한 것이 아닙니다.

## 보완점 1: 별도 관리 변수의 연결 결과가 범위·순서로 전달되지 않음

```c
int *storage;
unsigned amount, bound;
/* 필요한 경우 realloc으로 확장 */
storage[amount++] = value;
/* 네 번 추가 후 */
--amount;
```

03의 출력 `x190`에서 실제 결과는 다음과 같습니다.

```text
separate-array-structure:
  data=storage, length=amount, capacity=bound
  backingHistory=[o13,o25], length=3, capacity=6, status=consistent
array-structure (o25의 배열 보기):
  length=null, logicalOrder=null, inactiveRanges=null, status=unresolved
```

연결 근거가 전부 없는 문제가 아닙니다. 별도 변수 처리기는 길이·용량을 알아냈지만, 원소 범위·순서를 만드는 처리기와 그 근거가 통합되지 않습니다. `separateArrayStructures`의 출력에는 현재 `logicalOrder`도 없습니다.

공통 보완 방향: 저장소 ID·부분 범위·관리 역할·유효 시점·근거 사건을 공통 형태로 전달하고, 접두 사용 범위가 확인되면 같은 범위·순서 계산기를 사용해야 합니다. 재할당 시 이전 저장소의 비활성 상태와 새 저장소로 옮겨진 관계를 구별해야 합니다. 숫자 length 하나만으로 모든 후보를 접두 배열로 확정해서는 안 됩니다.

## 보완점 2: 묶음 복사·여러 원소 수 변경을 삽입 근거로 연결하지 못함

```c
if (count <= b->limit - b->used) {
    memcpy(b->base + b->used, source, count * sizeof *source);
    b->used += count;
}
```

04의 중간언어에는 이미 필요한 실행 사실이 있습니다.

```text
x44 WRITE/copy: o8 offset 0, size 12, 값 11·22·33
x50 WRITE: b.used = 3
x56 WRITE: b.used = 2
x66 출력 시 array-structure: length=null, logicalOrder=null
```

AST 바인딩은 단순 필드 간 비교와 개별 원소 접근, 일부 특정 복사 주소식을 중심으로 되어 있습니다. 이 코드의 `count <= limit - used`와 `base + used`, 여러 원소 크기의 복사를 관리 역할로 합치지 못합니다. 작업 판별에도 `Math.abs(delta) === 1` 중심의 제한이 있습니다.

08에서는 제거를 `return b->base[--b->used];`로 바꿨습니다. 제거 1건은 인식해도 삽입 근거가 없어 같은 누락이 유지됩니다. 원인을 단순히 제거 값을 읽지 않았기 때문이라고 돌릴 수 없습니다.

공통 보완 방향: 함수 이름별 예제 분기 대신, 계측된 쓰기/복사 범위와 AST 주소식·용량 조건·관리 값의 전후 변화를 연결해야 합니다. 여러 원소 삽입과 값을 읽지 않고 버리는 논리적 삭제도 표현할 수 있어야 합니다. 이번 문제를 고치기 위해 중간언어 생성 모델을 바꿀 필요가 있다는 증거는 없습니다.

## 보완점 3: 잠재적 관리 변수 모두의 수명이 후보 활성 상태를 결정함

```c
int a[8] = {10,20,30,40,50,60,70,80};
int n = 3, sum = 0;
for (int i = 0; i < n; ++i) sum += a[i];
printf("%d\n", sum);
```

05에서 `n=3`을 원소 수로 확정하지 않은 것은 올바릅니다. 하지만 `embedded-array-views.mjs`의 활성 조건에 모든 후보 필드의 생존 여부가 들어갑니다.

```js
role.fields.every(f => !f.objectId || alive.has(f.objectId))
```

실제 사건은 `x56`에서 i(o7)만 종료, `x59`에서 출력, `x63`에서 a(o4)를 포함한 main 지역 객체 종료입니다. 그런데 `x56` 이후 배열 후보가 `active:false`입니다. **중간언어가 a를 일찍 없앤 것은 아닙니다.** 추론 후보의 활성 상태가 임시 순회 변수와 묶이는 문제입니다. 물리 배열 정보는 별도로 남아 있지만, 이 후보를 소비하는 코드에서는 비활성 후보로 제외될 수 있습니다.

공통 보완 방향: 저장소 생존, 확인된 관리 역할의 유효성, 임시 순회 근거의 종료를 분리해야 합니다. 아직 선택하지 않은 후보 변수 하나의 소멸로 살아 있는 배열 전체의 표현 후보를 비활성화하지 않아야 합니다.

## 보완점 4: 점유 표시를 사용 집합으로 해석하지 못함

```c
if (!s->occupied[k]) {
    s->cell[k] = 7;
    s->occupied[k] = 1;
    ++s->count;
}
/* 제거 */
s->occupied[k] = 0;
--s->count;
/* 사용 */
if (s.occupied[i]) sum += s.cell[i];
```

07은 4·1·5번에 추가하고 1번을 지웁니다. 실제 원소 집합은 `{4,5}`이며 지운 1번 값 7은 메모리에 남습니다. 출력은 `2 14 7`입니다.

실제 결과는 같은 인덱스의 `cell`과 `occupied`를 묶는 `coindexed-record-candidate`까지입니다. 출력 `x200`에서 해당 조회는 partial이고, `cell` 배열의 `length`, `logicalOrder`, `inactiveRanges`는 모두 null입니다. `count` 역할도 연결되지 않습니다. 사용하지 않는 `[0,1,2,3]`을 자동으로 구분하지 못하며, 그렇다고 `[0,1]`을 사용 범위로 오인하지도 않습니다.

공통 보완 방향: 같은 인덱스 대응에 더해, 표시값이 데이터 접근을 제어하는 분기와 표시 변경·count 증감의 일치 근거를 연결해야 합니다. 단순히 0/1 값이라고 점유 표시로 간주해서는 안 됩니다. 사용 집합을 먼저 만들고 논리 순서는 독립적으로 미확정 상태를 허용해야 합니다.

## 기록과 재현

- `predictions.json`, `bulk-control-prediction.json`: API 실행 전 기대 결과.
- `run.mjs`, `compare.mjs`: 실행·조회와 기대 관계 비교. 불일치는 `comparison.json`에 남으며 성공으로 바꾸지 않습니다.
- `summary.json`, `bulk-control-summary.json`: 실제 값과 후보 메타데이터. `changedModelFiles: []`, 입력 불변성 포함.
- 각 예제 폴더의 `plan.json`, `trace.json`, `inference.json`, `summary.json`: 원본 실행·추론 기록.
- `comparison.json`: 성공한 항목과 불일치 항목, 복사 사건·수명 사건의 구체적 증거.

이번에 확인된 부족함은 위 네 범주입니다. 8개 정상 실행이나 중간언어 누락 0개를 자료구조 추론 완전성으로 해석하지 않습니다. 보완은 아직 적용하지 않았습니다.
