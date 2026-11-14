# assert 검증 사건의 재생 지원

2026-11-13. 기존 `FLOW/assert.check`의 재생 지원 누락을 수정했습니다. 중간언어 생성 모델과 추론기는 변경하지 않았습니다.

## 원인과 적용 계약

생성 모델은 이미 조건 검증을 기록하지만 `createRecording()`의 지원 목록과 조건 표시·전달 경로가 이를 처리하지 않았습니다. No43의 `x1360`은 실제로 검증을 통과한 사건인데도 재생기 로딩 단계에서 거부됐습니다. 이전 준비 시간 최적화 검사는 준비 Worker까지 확인했으며, 전체 기록을 재생기에 적재하는 검사가 빠져 있었습니다.

읽은 계약은 `presentation.md`, `animation.md`의 기본 원칙·값 전달·함수/조건·오류 정지, `animation-incidents.md`, `prepared-scene.md` PS-01~04, `visualization.md`·`ui.md` 관련 절, `c-model.md`의 assert 연결 및 실행 시각화 오류 계약입니다. 기존 필수 조건을 적용하며 새 연출이나 생성 의미를 추가하지 않습니다.

검증 전 기대값은 C의 `assert` 의미로 정했습니다. 증가식은 한 번만 실행되고, 참인 OR의 오른쪽 증가식은 생략됩니다. 실패한 검증 뒤의 `puts`는 실행되지 않으며 실제 실패 출력·종료 기록은 보존됩니다.

| 설계 조항 | 공통 변경 위치 | 검증 근거 | 상태와 남은 항목 |
| --- | --- | --- | --- |
| animation 기본 원칙: 기존 사건과 실제 결과 사용 | `playback.js` 지원 목록, `conditions.js` 공통 조건 FLOW 분류 | No43 29,474개 사건 적재 및 끝까지 상태 재생, 출력 일치; 검증 사건 4개 모두 통과 | 구현·상태 재생 검사 완료 |
| animation 값 전달: 완료 CALC 반복 금지 | `transfers.js` 공통 조건 판별·시간선 | 완료 CALC를 소비하는 검증에서 전달선·계산 단계가 반복되지 않음 | 관련 검사 완료 |
| animation 함수·조건: 기록된 판정 표시 | `conditions.js`, `main.js` 검증 명칭 | 성공·실패 표시, ALU 연결, Canvas FLOW 라벨 호출 검사 | 실제 브라우저 화면 가독성은 미검증 |
| animation 오류 정지: 실제 실패 경로 유지 | 기존 후속 사건 처리를 유지 | 실패 호출·stderr·종료 순서, 도달하지 않는 stdout 부재; 알 수 없는 FLOW는 계속 거부 | 관련 검사 완료 |
| PS-01~04: 기록과 준비 결과 경계 보존 | 준비·추론 경로는 변경하지 않음 | 검사 전후 plan/trace 전체 직렬화 동일 | 이번에는 준비 Worker 재검사 생략 |

## 검사 결과

- `tests/animation-assertions.test.js`, `animation-conditions.test.js`, `animation-transfer-phases.test.js`, `animation-playback.test.js`: **20개 통과**.
- 기존 No43 저장 기록을 그대로 사용해 `createRecording()`과 `Playback.seek()` 확인: 29,474개 모두 반영, stdout 동일. 검증 사건은 `x1360`, `x18986`, `x19946`, `x20011`입니다.
- 근거: `test-results/assert-playback-fix/focused-tests.log`, `no43.json`.
- Vite 제품 빌드 통과(`build.log`). 큰 번들 크기 경고는 남아 있습니다.
- 예제 파일명·변수명·특정 값에 따른 분기를 추가하지 않았습니다. 승인되지 않은 전체 예제 재실행은 하지 않았습니다.
