# 배포 ZIP 검증

2026-11-14. 자체 호스팅용 preview ZIP을 생성합니다. 사용자 승인에 따라 최종 소스를 커밋한 뒤 해당 커밋으로 ZIP을 다시 생성·검증하고 GitHub 프리뷰 릴리즈에 ZIP과 체크섬을 첨부합니다. 웹 서비스 자체를 외부 서버에 배포하는 작업과는 구별합니다.

게시용 패키징은 `--committed`로 Git HEAD의 archive만 읽습니다. 작업 중인 별도 세션 파일을 섞지 않고 `RELEASE.json.baseCommit`을 태그 대상과 대조합니다. 그래프 추론·축소 표시·배포 서버의 관련 검사 10개도 최종 커밋 전에 통과했습니다.

| 설계 계약 | 변경 위치 | 검증 | 상태 |
| --- | --- | --- | --- |
| presentation.md / UI 경계, PS-01 기존 실행·준비 과정 | `scripts/release/server.mjs` | 정적 빌드 파일 및 기존 실행 세션·예제 API를 그대로 연결 | 구현·격리 검증 통과 |
| inference-model.md 생성/추론 독립 경계 | 같은 서버의 기존 middleware 재사용 | 중간언어 생성/추론 알고리즘 수정 없음 | 구현 |
| 배포 파일 재현성 | `scripts/release/package.mjs` | 독립 소스 스냅샷 빌드, 기준 커밋/변경 상태/파일 해시. 복사 중 변경을 감지하면 중단 | 구현·ZIP 체크섬/내부 파일 해시 확인 |
| 정적 공개 범위 | `tests/release-server.test.js` | 웹 파일·도구 MIME, 비공개 경로·심볼릭 링크 경계, 잘못된 요청 | 1개 통합 검사 통과 |

## 압축 해제 후 확인

`node scripts/release/verify.mjs releases/<파일명>.zip`은 저장소 밖 임시 폴더에서 동봉 파일만 사용합니다. Node.js v24.22.1/Windows에서 다음을 확인했습니다.

- ZIP 자체와 내부 파일별 SHA-256 일치.
- 루트 시각화 HTML·번들 JavaScript·WASM 컴파일러 제공. 원본 서버 소스·package.json·.git의 HTTP 접근은 차단.
- 라우팅 WASM을 빌드 전에 스냅샷에 넣어 해시가 붙은 공개 에셋으로 변환. 번들에 미해결 node_modules 경로가 없고 WASM HTTP 응답의 MIME/해시가 원본과 일치하는지 검사.
- 직접 작성한 C 코드의 batch 입력 40 → 함수 호출/반환 → 출력 `42\n`, 실행 및 추론 완료.
- 같은 코드의 입력 대기 → 7 전달 → 출력 `9\n`. 재개 전후 runId 동일.
- 등록 예제의 세션 API 및 기존 예제 API 실행 완료.
- 원본 프로젝트의 node_modules를 사용하지 않도록 별도 프로세스와 저장소 밖 경로에서 검사.

별도 `pnpm install`이나 도구 다운로드 없이 위 검사가 통과했습니다. Linux/macOS 패키지는 별도로 실행 검증하지 않았습니다. Vite 빌드의 큰 청크 경고는 남아 있으며 빌드는 성공했습니다.

실제 브라우저의 1배속 가독성·모든 예제·다중 사용자 부하 검증은 하지 않습니다. Node.js는 별도 설치가 필요하며, 실행에 필요한 JavaScript 의존성과 C WASM 도구는 ZIP에 포함합니다.
