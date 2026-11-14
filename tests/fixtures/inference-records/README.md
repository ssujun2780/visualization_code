# 고정 실행 기록

이 폴더는 과거 컴파일·실행 결과를 변경 없이 gzip으로 저장합니다. 현재 추론기를 검사하기 위한 입력이며 현재 생성 모델의 새 실행 결과가 아닙니다.

- `manifest.json`의 소스 SHA-256, 압축 해제한 실행 SHA-256, 실행 전 소스에서 정한 stdout 기대값을 `frozenInferenceExecution()`이 검사합니다.
- 실제 구성원·순서·수명·조건·재연결 기대값은 각 테스트에 별도로 있으며 결과 JSON에서 추출해 정답으로 만들지 않습니다.
- `.gitattributes`로 소스 바이트와 압축 기록을 보존합니다.
- `range-lazy`, `selected-edges`, `pointer-comparator`는 2026-11-13에 기존 원본 그대로 추가했습니다. 신규 예상값으로 덮어쓰거나 생성 모델을 다시 실행한 기록이 아닙니다.
- 관련 재연결 테스트는 `test-results`를 입력으로 읽지 않습니다. `tests/inference-reproducibility.test.js`가 필요한 코드·fixture만 임시 폴더로 복사해 출력 폴더 없는 환경에서 두 테스트 파일을 실행합니다.

새 C 코드의 실제 계측 검사와 고정 기록을 소비하는 추론 검사는 구분합니다. 새 코드 검사는 출력 산출물을 `test-results`에 저장할 수 있습니다.
