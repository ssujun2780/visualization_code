# 정상 C 구현 다양성 점검

2026-11-13. 새 22개 소스/34개 실행으로 생성·추론·작업 분석·표현 준비·재생 경계를 검사했습니다. 제품 코드는 수정하지 않았습니다.

- create_cases.py/cases.json: 실행 전 소스, 예상 출력·WRITE 순서·호출 수와 소스 해시를 고정합니다. 예상값을 생성기/추론기에 전달하지 않습니다.
- run.mjs: GCC 원본 → 비계측 WASM → 중간언어 생성 → 재생기 적재/상태 재생 → 저장 왕복 → 추론 → 작업 관계 분석 → 표현 준비/시점별 배치 검사.
- inspect-replay.mjs: 기존 기록의 동일 폭 READ를 직전 재생 메모리와 대조하고 실제 Canvas의 전달선·FLOW 함수를 표본 호출합니다. 브라우저 가독성 검사는 아닙니다.
- profile-stage.mjs: 저장된 입력으로 특정 공통 단계만 CPU 표본 조사.
- summarize.mjs: 실패를 보존하며 집계.

최초 도구 실행의 Windows 줄바꿈 및 GCC 한글 절대 경로 문제는 도구에서만 수정했습니다. 디스크 소스를 해시하고 GCC에는 상대 경로를 전달합니다. 실제 결과에 맞춰 예상 C 출력이나 검사 기준을 바꾸지 않았습니다. VLA 보조 관찰 경고도 원본 실패 목록에 남겼습니다.

저장소 루트에서 필요한 사례만 실행합니다.

    node example/c/codex_code/end_to_end_audit_20261113/run.mjs suite 21_named 22_literal
    node example/c/codex_code/end_to_end_audit_20261113/inspect-replay.mjs 09_callback_records-fixed
    node example/c/codex_code/end_to_end_audit_20261113/summarize.mjs

결과: test-results/codex_code-results/end_to_end_audit_20261113/.
각 사례의 prediction.json, report.json, execution.json.gz, inference.json.gz, prepared.json.gz, process-evidence.json을 함께 보십시오. 압축 파일은 JSON 파싱 후 decodeExecution/decodeInference로 원래 형태를 복원합니다.

분석은 [검증 보고서](../../../../docs/validation/diverse-end-to-end-audit-2026-11-13.md)에 있습니다.
