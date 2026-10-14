# C 작업실

C 소스 하나를 입력하고 실제로 컴파일·실행하는 최소 웹입니다.

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
추후 실행 시각화 엔진을 이 경계에 연결할 수 있습니다. 현재 버전은
단계별 실행·메모리 시각화·캐릭터 애니메이션을 구현하지 않습니다.

## 사용한 공개 도구

- [Runno WASI](https://github.com/taybenlor/runno), MIT
- [wasm-clang](https://github.com/binji/wasm-clang), Clang/LLVM WASM 빌드
- [fflate](https://github.com/101arrowz/fflate), MIT
- [Vite](https://vite.dev/), MIT
- [Monaco Editor](https://github.com/microsoft/monaco-editor), MIT

Clang, wasm-ld, sysroot는 Runno가 제공하는 wasm-clang 파일입니다.
배포되는 도구의 라이선스는 `public/toolchain/LICENSE-*.txt`에 함께 보관합니다.
