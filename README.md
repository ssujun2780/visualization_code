# C 작업실

C 소스 하나를 입력하고 실제로 컴파일·실행하는 최소 웹입니다.

## 설계 문서

- [애니메이션·시각화·UI 문서 안내](docs/design/presentation.md)
- [애니메이션](docs/design/animation.md): 명령·사건·시간선과 연출
- [시각화](docs/design/visualization.md): 공간·상자·연결선·설계도·오류 표현
- [UI](docs/design/ui.md): 편집·재생·입력·선택과 오류 안내
- [실행 관찰과 중간언어 연결](docs/design/execution-visualization.md), [공통 C 모델](docs/design/c-model.md)

## 실행

Node.js 22 이상과 pnpm 11을 사용합니다.

```sh
pnpm install
pnpm toolchain
pnpm dev
```

기본 주소: http://127.0.0.1:5173

```sh
pnpm build
pnpm preview
```

## 기능

- Hello World 기본 `main.c`, Monaco 기반 VS Code 스타일 편집기
- C 문법 강조, 괄호 자동 완성·색상, 들여쓰기 안내선, 코드 접기·미니맵
- Enter 자동 들여쓰기, 선택한 여러 줄의 Tab / Shift+Tab 들여쓰기·내어쓰기
- Ctrl+F 찾기, Ctrl+H 바꾸기, Ctrl+Z 실행 취소, 여러 커서 편집, 편집기 확대
- Ctrl+Space C 코드 조각·문서 내 단어 자동 완성 (C 언어 서버 기반 IntelliSense는 아님)
- 컴파일·실행 버튼, Ctrl/Cmd+Enter, 사용자 중지
- `scanf` 등을 위한 표준 입력과 EOF 전달
- 표준 출력, 표준 오류, 컴파일 경고·오류의 편집기 밑줄과 위치 이동
- 브라우저 내 코드·입력 자동 저장
- 기본 코드, Hello World, 두 수 더하기 예제

## 실행 구조

Web Worker에서 Clang → wasm-ld → WASI 프로그램 실행 순서로 동작합니다.
사용자 코드와 표준 입력은 서버에 전송하지 않습니다. 컴파일러·표준 헤더·
라이브러리 파일은 `public/toolchain`에서 제공하므로 실행 시 외부 컴파일 API가
필요하지 않습니다. 도구를 처음 준비할 때만 `pnpm toolchain`으로 다운로드합니다.

준비·컴파일 제한은 60초, 프로그램 실행 제한은 5초, 출력 제한은 합계 128KiB,
프로그램 선형 메모리 상한은 128MiB, 스택은 1MiB입니다. 중지·시간 초과 시
Worker를 종료합니다. 초기 버전은 단일 파일, C11, wasm32/WASI 환경을 대상으로
합니다. 네이티브 운영체제 API나 사용자 DLL은 지원 범위에 포함하지 않습니다.
브라우저 안에서의 실행 시간이며, 네이티브 C 프로그램 벤치마크는 아닙니다.

`src/runner.worker.js`는 컴파일·실행을 담당하고 `src/main.js`는 편집·출력 UI를
담당합니다. `src/code-editor.js`는 Monaco 설정과 C 코드 조각, 컴파일 진단 표시를
담당합니다. 컴파일 오류 표시는 실행 버튼으로 컴파일한 뒤 갱신됩니다.
`animation.html`에서는 중간언어 기록의 단계별 재생과 메모리·자료구조 시각화를
제공합니다. 캐릭터 애니메이션은 아직 구현하지 않습니다.

## 공통 C 중간언어 기본 모델

AST의 소스 작업으로 중간언어 명령을 정의하고, LLVM 공통 계측으로 얻은 실제
실행값을 연결합니다. 공개 출력은 스키마 3의 명령 정의와 실행 기록입니다.

```sh
pnpm trace:c examples/c/instrumentation-basic.c
pnpm trace:c 코드.c --stdin 입력.txt --out-dir test-results/my-code
pnpm trace:c 코드.c --compile-only --out-dir test-results/ir-only
pnpm trace:c 코드.c --with-observations --out-dir test-results/ir-debug
```

기본 JSON은 **`definitions.json` 공통 정의 + 참조형 `plan.json`·`trace.json`**으로 저장합니다.
추론 CLI와 웹 기록 열기는 두 형식을 모두 지원하며, 새 파일을 열 때는 `definitions.json`도 함께 선택합니다.
기존 펼친 JSON이 필요하면 `--expanded`, 들여쓰기는 `--pretty`를 추가합니다.
추가 사건 사본 `trace.jsonl`은 `--jsonl`, 원시 관찰은 `--with-observations`로 선택합니다.
직접 읽는 도구는 `scripts/shared/execution-files.mjs`의 `readExecutionFiles(폴더)`를 사용합니다.
실행 사건·값·순서와 추론 결과 분리는 유지합니다. [저장 계약](docs/design/execution-storage.md)

`test-results/c-model`에 원본·계측 LLVM 코드, 중간언어 명령 정의, 실행 JSON(선택 시 JSONL),
객체·프레임·참조를 저장합니다. 함수·재귀·포인터·구조체·배열·
분기·반복과 동적 할당을 공통 경로로 관찰하며, 정답이나 자료구조의 의미를 미리
지정하는 인자는 없습니다. 미지원 항목과 미관측 라이브러리 효과는 따로 표시합니다.
Clang AST를 함께 읽어 C의 부호 정보와 LLVM에서 사라진 동일 폭 정수 변환도
연결합니다. unsigned는 자료형의 `u` 배지 정보로 기록합니다.
`--compile-only`는 사용자 C를 실행하지 않습니다. 원시 관찰 자료는
`--with-observations`로 별도 출력합니다. 생성 모델은 애니메이션을 실행하지 않으며,
별도 시각화 페이지가 이 기록을 읽어 재생합니다.

정확한 지원 범위, 실행 제한, 기록 계약은 [공통 C 중간언어 모델](docs/design/c-model.md)에 있습니다.

자료구조 추론은 별도 단계입니다. 저장된 중간언어를 읽어 `inference.json`만 추가하며,
C 코드를 다시 실행하거나 `plan.json`·`trace.json`을 수정하지 않습니다.

```sh
node scripts/trace-model.mjs 코드.c --with-observations --out-dir test-results/my-code
node scripts/infer-structures.mjs test-results/my-code
```

추론만 실행할 때는 `pnpm infer:c test-results/my-code`도 사용할 수 있습니다.
`--with-observations`는 선택 사항이며, 함께 저장하면 런타임 배열과 과거 참조 등
보조 관찰 근거도 사용할 수 있습니다. API와 오류 격리는 [추론 모델 분리](docs/design/inference-model.md)를 참고하십시오.

## 초기 최소 계측 시제품

다음 명령은 예제 C를 Clang으로 분석하고, 관찰 코드를 자동 삽입한 C를 실제로
컴파일·실행하여 중간 언어와 실행 사건을 기록합니다. 추가 패키지나 네이티브
컴파일러 설치 없이 기존 `public/toolchain` 파일을 사용합니다.

```sh
pnpm trace:prototype
pnpm trace:prototype examples/c/instrumentation-basic.c --out-dir test-results/my-trace
```

기본 예제는 `int a=10; int b=20; int c=a+b*2;`이며 실행 기록에서
`a=10`, `b=20`, `c=50`을 확인할 수 있습니다. 계산은 C에서 수행하고,
JavaScript는 관측한 값과 사건의 연결을 저장합니다.

기본 기록 폴더는 `test-results/instrumentation-prototype`입니다.

| 파일 | 내용 |
| --- | --- |
| `original.c`, `original.ast.txt` | 원본과 번들 Clang이 출력한 실제 AST |
| `instrumented.c` | AST에서 자동 생성한 관찰 코드가 포함된 C |
| `plan.json` | READ·WRITE·CALC·FLOW·SPACE의 관찰 계획과 장면 묶음 |
| `trace.json`, `trace.jsonl` | 실제 실행값·주소·이전 쓰기·값의 출처와 오류 |
| `diagnostics.txt` | 컴파일 경고와 도구 진단 |

지원 범위는 매개변수 없는 `int main`, 일반 signed 32비트 int의 선언과 초기화,
대입, 괄호, `+ - * / %`, 단항 `+ -`, 반환입니다. 여러 변수의 한 문장 선언과
main의 암묵적인 0 반환도 처리합니다. 초기화되지 않은 값을 사용하거나 정수
연산이 범위를 벗어나면 해당 읽기·연산 전에 기록하고 중단합니다.

이번 구현은 Clang 8의 텍스트 AST를 사용하는 **소스 변환 기반 CLI 시제품**입니다.
웹 UI와 LLVM 계측 패스는 아직 연결하지 않았습니다. 전처리 지시문, 다른 자료형,
함수 호출, 조건·반복, 포인터 등 미지원 구문은 실행 전에 명시적으로 거부합니다.
변수 이름은 ASCII 식별자만 지원하며 `__cv_` 접두사는 기록 코드용으로 예약합니다.
관찰을 위해 지역변수의 주소를 전달하므로, 기록된 배치는 비계측 프로그램의
배치나 성능을 대표하지 않습니다. 두 산술 CALC가 같은 표현식 장면에 속할 수 있으며,
계획상의 나열 순서와 실제 실행 사건의 순서는 구분합니다.

`pnpm test`는 실제 Clang/WASI 실행을 사용하여 변경된 입력, 출처 연결,
비계측 실행과의 반환값 일치, 미초기화·0 나눗셈·오버플로 중단 등을 검증합니다.
상위 설계는 [C 실행 관찰과 시각화 설계](docs/design/execution-visualization.md)에 있습니다.

## 복합 C11 코드의 계측 실험

900줄의 정규식 동치 판정기를 대상으로 고정된 예측과 실제 실행 기록을 비교합니다.

```sh
pnpm trace:regex
```

이 명령은 MinGW GCC를 사용합니다. 기본 경로는 `C:\msys64\mingw64\bin\gcc.exe`이며
`CC` 환경변수로 다른 GCC 실행 파일을 지정할 수 있습니다. 원본은
`examples/c/regex_equivalence.c`, 실행 전 예측은 `examples/c/regex-equivalence-predictions.json`입니다.

GCC의 함수 진입·복귀 계측과 **이 예제에 명시적으로 선택한 소스 관찰 지점**을
결합합니다. 범용 자동 C 계측기가 이 코드를 지원하게 된 것은 아닙니다.
일반 정수 시제품의 `trace:prototype`과 새 공통 모델의 `trace:c`도 별개입니다.

`test-results/regex-equivalence-trace`에 계측 C, 관찰 계획, 사건별 JSONL,
구조별 JSON, 비교 결과와 실제 연결로 만든 `cycles.mmd`를 기록합니다.
변수명 대신 관측된 참조·인덱스·복사 폭·접근 규칙으로 표현 후보를 제안합니다.
구조 뷰는 정리 직전의 역사적 상태이며, 최종 할당은 별도로 해제 기록을 남깁니다.

자세한 해석과 관찰 한계는 [복합 코드 계측 결과](docs/design/regex-equivalence-instrumentation.md)에 있습니다.

## 사용한 공개 도구

- [Runno WASI](https://github.com/taybenlor/runno), MIT
- [wasm-clang](https://github.com/binji/wasm-clang), Clang/LLVM WASM 빌드
- [fflate](https://github.com/101arrowz/fflate), MIT
- [Vite](https://vite.dev/), MIT
- [Monaco Editor](https://github.com/microsoft/monaco-editor), MIT

Clang, wasm-ld, sysroot는 Runno가 제공하는 wasm-clang 파일입니다.
배포되는 도구의 라이선스는 `public/toolchain/LICENSE-*.txt`에 함께 보관합니다.
## 직접 작성한 코드 시각화

시각화 페이지(`animation.html?source=direct`)에서 **C 코드 직접 입력**을 펼치고 코드를 작성·붙여넣은 뒤 **컴파일·시각화** 또는 **Ctrl+Enter**를 누르세요. **재생**으로 과정을 확인하며, 입력이 필요하면 입력 돗자리에서 기다립니다. 같은 페이지에서 코드를 편집하고 다시 실행할 수 있습니다. 기존 C 작업실의 **현재 코드 시각화 →** 경로도 사용할 수 있습니다.

등록된 예제와 직접 작성한 소스는 같은 실행 세션 API를 사용합니다. 자세한 계약은 [UI 설계](docs/design/ui.md), 검증 내용은 [동적 코드 연결](docs/validation/dynamic-source.md)에 있습니다.
## 실행 관계 추론기

저장된 `plan.json`·`trace.json`에서 **부모·자식 호출, 관측된 접근 구간, 출처로 확인된 복사 관계**를 읽는 별도 API/CLI입니다. 알고리즘 이름·정확성을 단정하지 않으며 중간언어 생성·자료구조 추론·화면 실행에 자동 연결하지 않습니다.

```sh
node scripts/infer-execution-relations.mjs test-results/c-model
```

결과는 `execution-relations.json`에 저장합니다. [설계와 API](docs/design/execution-relations.md), [예상/실제 비교와 구현 대응표](docs/validation/execution-relations-rules.md)를 참고하십시오.

현재 사건에서 함께 볼 배열 구간·지역변수 관찰·연산·호출·코드 위치는 `createExecutionWorkQuery(plan, trace, relations).at(executionId)`로 조회합니다. 살아 있는 대상과 과거 기록을 구별하며 값 재계산·배치·화면 연결은 수행하지 않습니다. [작업 문맥 조회 계약과 검증](docs/validation/execution-work-context.md)을 참고하십시오.
