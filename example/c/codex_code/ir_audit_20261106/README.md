# 2026-11-06 중간언어 추가 점검 코드

자료구조 추론을 제외하고 값·작업 순서·호출·타입·수명·오류 처리 경계를 확인한 정상 C 프로그램 50개입니다. `cases.json`에 실행 전 예상 출력과 과정이 있습니다. 공통 모델은 이 점검에서 수정하지 않았습니다.

검사 보고서: [REPORT.md](../../../../test-results/ir-audit-2026-11-06/REPORT.md).

저장소 루트에서 필요한 사례만 실행할 수 있습니다.

```powershell
node example/c/codex_code/ir_audit_20261106/run.mjs 35_pointer_selected_callback 36_split_function_pointer
node example/c/codex_code/ir_audit_20261106/inspect.mjs 35_pointer_selected_callback FLOW
```

`run.mjs`는 기존 결과를 attempts에 보관합니다. 결과는 `test-results/ir-audit-2026-11-06/`에 저장하며 이 폴더는 기존 .gitignore에 따라 Git에서 제외됩니다. `make-cases.mjs` 등 생성 스크립트는 사전 예측 작성 경위를 남긴 자료이며, 현재 완성된 cases.json을 검토할 때 다시 실행할 필요가 없습니다.

오류 발생용 C는 정상 프로그램 목록과 분리되어 결과 폴더의 faults에 저장됩니다. 해당 코드는 네이티브 실행하지 않습니다. 전체 기존 No1~No46을 재검사하는 도구가 아닙니다.
