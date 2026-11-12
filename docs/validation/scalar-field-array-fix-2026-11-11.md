# 단일 포인터 필드의 배열 오인식 수정

## 적용 계약과 변경

`presentation.md`의 모델·추론 경계, `inference-model.md`의 읽기 전용 소비자 계약, `structure-presentation-policy.md`의 적용 규칙 6, `array-container-inference.md`의 저장소 범위 규칙을 적용했습니다. 중간언어 생성 모델과 UI는 변경하지 않았습니다.

기존 일반 배열 경로는 구조체 필드의 범위를 제한했지만, 포인터 기반 컨테이너 경로는 `할당 크기 - 포인터 오프셋`을 그대로 용량으로 사용했습니다. 그래서 `N **s=&a->q; *s=0;`의 단일 포인터 필드가 배열이 됐습니다. 실제 배열 필드도 뒤쪽의 다른 필드까지 포함할 수 있었습니다.

| 계약 | 공통 구현 | 검증 근거 |
| --- | --- | --- |
| 실제 객체·하위 객체 범위 보존 | `array-storage-extent.mjs`: 객체 ID·오프셋과 컴파일러 타입·필드 크기로 범위를 계산 | 앞쪽/중첩 필드, 뒤쪽 필드가 있는 배열, 자동/동적 저장소 |
| 경로에 무관한 동일 판단 | `array-views.mjs`와 `embedded-array-views.mjs`가 같은 범위 판정을 사용 | 기존 실패 검사와 추가 변형 모두 통과 |
| 배열과 단일 객체 구분 | 스칼라 필드와 단일 레코드를 배열로 승격하지 않고, 실제 배열 선언·접근 근거 유지 | 한 칸 포인터 배열, 한 칸 레코드 배열, typedef·const, 별칭·함수 인자, 대상 재연결 |
| 원본 모델·기록·검사 기준 보존 | 추론에서만 파생 범위를 변경 | 생성 모델 46개 파일 및 기존 검사 파일 2개의 SHA-256 불변, 고정 계획·실행 기록 해시 불변 |

## 검사

추가 검사 4개는 수정 전에 모두 실패했습니다. 기대값은 실제 C 선언의 필드 범위와 배열 원소 수에서 정했고 그대로 유지했습니다. 이후 한정 타입과 한 칸 레코드 배열을 함께 확인하는 검사 1개를 추가했습니다. 이 검사도 수정 중 실패를 확인한 뒤 공통 타입 해석과 배열 근거 처리를 보완했습니다. 기존 실패 검사나 기대값은 수정하지 않았습니다.

관련 **39개 검사 모두 통과**했습니다.

```text
node --test tests/ir-array-subobjects.test.js tests/ir-array-role-identity.test.js tests/ir-linked-views.test.js tests/ir-array-roles.test.js tests/ir-array-containers.test.js tests/inference-separation.test.js
```

기존 원본 계획·실행 기록으로 추론만 재실행해, 단일 레코드에 잘못된 배열이 없어졌고 별도의 10,000칸 힙 배열은 유지됨을 확인했습니다. 원본 계획·사건·값·수명은 변경되지 않았습니다. 전체 예제를 다시 실행하지 않았습니다.

결과: `test-results/scalar-field-array-fix-2026-11-11/`의 `before.log`, `qualified-before.log`, `related.log`, `verification.json`, `original.inference.json`.

## 범위와 남은 항목

요청한 오인식과 관련 회귀 검사에서 남은 실패는 없습니다. 모든 C 저장 표현의 인식을 보장하는 검증은 아니며, 화면은 확인하지 않았습니다. 이전 작업의 AVL/RB 관계 추론이나 중간언어 생성 경로는 변경하지 않았습니다.
