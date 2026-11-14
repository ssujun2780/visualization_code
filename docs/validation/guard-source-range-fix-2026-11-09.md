# 암묵적 참거짓 검사의 소스 범위 수정

2026-11-09 초심자·혼합 자료구조 검증 보고서의 중간언어 위치 정보 문제(9번)를 수정했습니다. 자료구조 추론과 UI는 이번 수정 범위에 포함하지 않았습니다.

`if (p->flag)`를 CALC/truth로 기록할 때 기존 CALC의 AST 표현식은 갱신하면서 source 범위에는 LLVM 피연산자 위치인 `p`만 남는 경우가 있었습니다.

`scripts/model/guard-conditions.mjs`의 공통 조건 연결 경로에서 정규화된 AST 조건 표현식과 source 범위를 함께 갱신합니다. 기존 CALC 재사용과 새 CALC 생성 모두 같은 필드를 사용합니다. 매핑할 수 없는 AST 범위는 기존 위치 정보를 유지합니다. 변수 이름·필드 이름·예제 상수에 따른 분기는 추가하지 않았습니다.

원본 코드의 의미를 다시 해석하지 않습니다. 기존 sourceMap으로 AST 범위를 변환하고 표시할 텍스트와 토큰 끝 위치만 얻습니다. 의미 분석용 소스 스캔 수는 0입니다.

검증:

- 새 회귀 검사에서 수정 전 멤버 조건과 여러 줄 조건의 범위 오류를 재현했습니다.
- 멤버·배열·역참조, if/while/do/for, 명시적 비교, 매크로, CRLF 및 UTF-8/UTF-16 위치를 검사했습니다.
- 관련 테스트 18개 통과: `ir-guard-source-ranges`, `ir-guard-conditions`, `ir-source-map`, `ir-macro-expression-binding`.
- 기존 `truth_member_source_false`, `truth_member_source_true`, `rope_manual_flags` 세 예제를 다시 실행했습니다. 수정 전후 events+objects 해시가 모두 동일했습니다.
- `p->flag` 범위는 7행 9–10열에서 9–16열로 수정되었습니다. 명시적 비교 `p->flag != 0`은 그대로입니다.
- 컴파일만 수행하는 API에서도 전체 범위를 확인했습니다. 예제 전체 재실행은 하지 않았습니다.

재현 명령:

```powershell
node --test tests/ir-guard-source-ranges.test.js tests/ir-guard-conditions.test.js tests/ir-source-map.test.js tests/ir-macro-expression-binding.test.js
node test-results/codex_code-results/guard-source-range-fix-2026-11-09/verify.mjs
```

실제 전후 범위와 해시: `test-results/codex_code-results/guard-source-range-fix-2026-11-09/verification.json`.
