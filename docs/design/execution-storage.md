# 공통 정의·실행 기록·추론 결과의 저장 분리

2026-11-13 구현. 저장·전송과 실행 중 관찰의 공통 정의를 공유합니다. C 실행·계산 묶음·사건 순서와 자료구조 추론 규칙은 그대로이며 관찰 바이트 예산의 계산 방식은 EF-04를 따릅니다.

## EF-01 공통 정의

`definitions.json`은 `execution-definition-table-v2`이며 자료형, 구조체 필드 설명, AST 표현식, 소스 위치와 반복되는 객체의 필드 구성을 한 번씩 보관합니다. 항목에는 실행별 표 식별자와 정의 목록이 있습니다.

속성 세 개 이상의 객체는 필드 이름 목록과 순서대로 나열한 값으로 저장합니다. `$d`는 공통 정의 참조, `$r`은 `[필드 구성 ID, 값, …]`입니다. 필드 구성만 공유하며 사건·실행 값은 각각 그대로 남습니다. 동명 예약 키는 escape하고 속성 순서·누락/undefined·특수 값은 복원합니다.

동일한 내용만 공유합니다. 자료형 ID만으로 합치지 않고 const 등의 한정자·부호·크기·표시 정보, 표현식의 노드 ID와 코드 위치도 비교합니다. 객체·사건의 식별자나 같은 숫자를 가진 서로 다른 실행 값은 병합하지 않습니다. 누락된 값이나 근거를 추측하지 않습니다.

## EF-02 저장 형식과 복원

기본 CLI는 공통 정의를 참조하는 `execution-definitions-v2` 형식의 `plan.json`·`trace.json`을 출력합니다. 각 파일의 `definitionsId`가 공통 정의 표와 일치해야 합니다. 원시 관찰 파일도 같은 표를 사용할 수 있으며 추론 결과는 기존 `inference.json`에 따로 저장합니다. 기존 v1 공통 정의 파일과 펼친 JSON도 읽습니다.

- `definitions.json`: 공통 정의.
- `plan.json`: 명령·선언·함수·관찰 연결 계획과 공통 정의 참조.
- `trace.json`: 실제 사건·값·대상·출처·객체/프레임 수명과 공통 정의 참조.
- `trace.jsonl`: `--jsonl` 선택 시 참조형 사건을 한 줄씩 저장한 추가 사본. 해당 `trace.json`/`definitions.json`과 함께 읽습니다. 기본 출력에서는 생략합니다.
- `observations.plan.json`·`observations.trace.json`: `--with-observations` 또는 변환 실패/부분 변환에서 보존하는 원시 관찰. compile-only의 계획만 있는 관찰도 읽습니다. 해당 실행에서 출력하지 않는 선택 파일은 기존 파일도 제거해 과거 관찰이 섞이지 않게 합니다. 지정된 산출물 이름 외 사용자 파일은 건드리지 않습니다.
- `inference.json`: 선택적인 자료구조 추론 결과. 생성 CLI는 이 파일을 생성하거나 수정하지 않습니다.

공통 형식은 `scripts/shared/execution-format.mjs`, 파일 입출력은 `scripts/shared/execution-files.mjs`가 담당합니다. 어느 생성기나 추론기도 호출하지 않습니다. API의 `traceModel()` 반환값은 기존의 일반 plan/trace 객체이고, 파일/HTTP 경계에서만 인코딩합니다. 소비자는 복원 뒤 기존 스키마 3 객체를 받습니다.

정의 참조가 없는 옛 JSON은 그대로 읽습니다. 예약 속성명·undefined·비정상 실수·음의 0·빈 배열 슬롯도 구분해서 복원합니다. 잘못된 참조, 다른 표와의 혼합, 순환 정의는 오류입니다. 입력 객체를 수정하거나 동결하지 않습니다. 별도 스냅샷을 만들 때는 같은 객체의 이전 내용을 캐시하지 않습니다.

```js
import {readExecutionFiles} from './scripts/shared/execution-files.mjs';
const {plan, trace, observations} = await readExecutionFiles('test-results/my-code');
```

번들 파일은 `encodeExecution({plan, trace, ...})`와 `decodeExecution(bundle)`로 처리합니다. 분리 파일을 브라우저에서 선택할 때는 `definitions.json`도 함께 선택하며 `decodeExecutionDocuments()`가 표 연결을 확인합니다.

## EF-03 CLI·HTTP 호환

```sh
node scripts/trace-model.mjs my-code.c --out-dir test-results/my-code
node scripts/trace-model.mjs my-code.c --jsonl --with-observations --out-dir test-results/debug
node scripts/infer-structures.mjs test-results/my-code
node scripts/infer-execution-relations.mjs test-results/my-code
```

기본 JSON은 서식 공백 없이 저장합니다. `--pretty`는 들여쓰기, `--expanded`는 공통 정의를 다시 펼친 옛 저장 형식입니다. 둘을 함께 쓰면 기존 형태로 사람이 읽을 수 있습니다. 다른 조사/보고 도구에서 사용하는 `writeJSON()`의 기본 들여쓰기는 바꾸지 않습니다.

웹 클라이언트는 `Accept: application/vnd.c-workbench.execution+json`으로 공통 정의 형식을 요청합니다. 실행 시작과 입력 대기 재개 응답에서 모두 사용하며, 복원한 뒤 기존 재생기로 전달합니다. 요청 헤더가 없는 기존 클라이언트에는 옛 JSON을 반환합니다. HTTP 본문은 JSON이며 응답은 `Vary: Accept`를 명시합니다.

파일/HTTP 복원과 재생기 입력 호환을 검사했고 화면의 배치·애니메이션은 변경하지 않았습니다. 가독성·실제 화면 조작 검증은 별개입니다.

## EF-04 관찰 한도와 경계

`ModelRecorder`는 `observation-storage.mjs`를 통해 생성 시점의 사건을 저장합니다. 새 공통 정의와 참조형 사건 각각의 UTF-8 JSON 바이트 + 구분자 1바이트를 합산합니다. 이미 있는 정의는 다시 계산하지 않습니다. 기본 16 MiB·최대 64 MiB 수치는 유지합니다. 내용 기반으로 공유한 정의는 저장소 내부의 불변 객체이며 입력 계획/자료형은 수정하거나 동결하지 않습니다. 실행 값과 사건 객체는 서로 독립적으로 남고 관찰 훅의 완료 근거를 추가할 수 있습니다.

거부된 사건의 신규 정의는 원상 복구하고 사건 ID를 소비하지 않습니다. 기존과 같이 마지막 ERROR는 한도를 넘어도 보존합니다. coverage에 `observationEncoding`, `observationEventBytes`, `observationDefinitionBytes`, `observationDefinitionCount`와 합계 `observationBytes`를 남깁니다.

이 예산은 **사건 생성 시점의 압축 기록 비용**입니다. 이후 붙는 완료 근거·객체/프레임 상태·계획·공개 중간언어·API 포장까지 합친 파일 크기나 프로세스 RAM 상한은 아닙니다. 모든 실행 사건을 메모리에 유지하는 구조는 그대로이며 디스크 스트리밍 기록기는 아닙니다. 관찰 제한 자체를 제거하지 않습니다.

No43은 기본 바이트 한도 안에서 전체 실행을 완료하며, 한도를 높여 확보한 수정 전 정상 종료 기록과 사건·값·출처·수명이 같습니다. [후속 검증](../validation/runtime-definitions-2026-11-13.md)을 참고하십시오. [최초 분리 검증](../validation/execution-definitions-2026-11-13.md)의 한도 중단은 후속 수정 전 이력입니다.
