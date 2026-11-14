# C 작업실 배포 ZIP

이 파일은 화면과 실행·분석 서버를 함께 담은 **자체 호스팅용 preview 배포본**입니다. Vercel 정적 업로드 전용 ZIP이나 Windows 설치형 EXE가 아닙니다.

## 바로 실행

1. Node.js 22 이상이 설치된 Windows/Linux/macOS 컴퓨터에 ZIP을 전부 풉니다. Node.js 실행 파일 자체는 포함하지 않습니다.
2. Windows에서는 `START-WINDOWS.cmd`를 실행합니다. 다른 환경에서는 압축을 푼 폴더에서 `node scripts/release/server.mjs`를 실행합니다.
3. 브라우저에서 `http://127.0.0.1:5173/`을 엽니다. 시각화는 `/`, 기존 코드 편집기는 `/index.html`입니다.
4. 종료하려면 서버 터미널에서 Ctrl+C를 누릅니다.

미리 빌드한 화면, 런타임 JavaScript 의존성, WASM C 컴파일러·링커·표준 라이브러리를 포함하므로 실행할 때 `pnpm install`이나 별도 컴파일러 설치가 필요하지 않습니다. Node.js 설치 후에는 외부 컴파일 서비스 없이 사용할 수 있습니다.

## 서버에 배포

압축을 풀고 Node.js로 같은 서버를 실행합니다. 기본 바인딩은 로컬 전용입니다. 서버 주소/포트는 환경변수로 선택합니다.

PowerShell:

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '8080'
node scripts/release/server.mjs
```

Linux/macOS:

```sh
HOST=0.0.0.0 PORT=8080 node scripts/release/server.mjs
```

웹 화면과 `/api/animation/` API는 같은 주소에서 제공합니다. 운영 시 프로세스 관리자와 HTTPS 역방향 프록시 뒤에 배치할 수 있습니다. 현재 로그인/공개 서비스용 사용자별 할당량 기능은 포함하지 않습니다. 실행 세션은 해당 프로세스 메모리에 유지되므로 여러 서버로 확장하면 세션 고정 또는 별도 세션 설계가 필요합니다.

대형 예제는 시간과 메모리를 많이 사용할 수 있고 기존 실행·추론 한도는 그대로입니다. 배포 ZIP이 모든 C 코드나 대규모 공개 서비스의 완전성을 보장하는 것은 아닙니다.

## 포함 파일과 재현

- `dist/`: 빌드된 웹 화면·Worker·에셋
- `scripts/`: 기존 실행·중간언어 생성·추론·배포 서버
- `public/toolchain/`: WASM 도구와 해당 라이선스
- `node_modules/`: 실행에 필요한 플랫폼 독립 의존성
- `src/`, `examples/`, `tests/`, `docs/`: 소스·예제·검사·설계 문서
- `THIRD_PARTY/`: 동봉 의존성의 라이선스·고지
- `RELEASE.json`: 기준 커밋, 미커밋 상태, 소스 스냅샷 식별자와 파일 해시
- `SHA256SUMS.txt`: 압축 내부 파일별 SHA-256

저장소의 `.git`, 개인 환경 파일, 테스트 결과·캐시, 로컬 Node 실행 파일은 포함하지 않습니다. 미커밋 변경이 포함된 경우 `RELEASE.json`에 표시하며 정식 Git 태그와 구분합니다.

개발 소스를 다시 빌드하려면 pnpm 11을 준비하고 `pnpm install --frozen-lockfile`, `pnpm build`를 실행합니다. Git 작업 폴더에서는 `pnpm release:zip`으로 독립 소스 스냅샷을 빌드하여 `releases/`에 ZIP과 체크섬을 만듭니다.

GitHub 릴리즈용은 최종 커밋 후 `node scripts/release/package.mjs --committed`로 생성합니다. 이 모드는 HEAD 커밋을 Git archive로 읽으므로 작업 폴더의 다른 미커밋 파일이 섞이지 않습니다. `RELEASE.json`의 `baseCommit`과 릴리즈 태그의 커밋을 일치시키고 ZIP과 `.sha256` 파일을 함께 첨부합니다.

배포 서버의 정적 파일 제공 및 기존 API 연결만 추가했습니다. 중간언어·추론·시각화 의미는 기존 경로를 사용합니다. 패키지 검증 범위는 `docs/validation/release-package.md`를 확인하십시오.
