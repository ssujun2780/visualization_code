# 정상 실행·비효율 코드 검사

2026-11-06 추가 감사용 C 코드 64개입니다. 중간언어 생성 모델은 수정하지 않았습니다. 기존 No1~46 검증과 별도입니다.

각 소스의 예상 출력·작업과 SHA256은 실행 전 `cases.json`에 저장했습니다. 생성 스크립트는 감사 과정의 근거이며, 기존 파일을 다시 생성하기 위해 실행할 필요는 없습니다.

프로젝트 루트에서 선택 실행:

```powershell
node example/c/codex_code/human_style_20261106/run.mjs 51_indirect_expression
```

이미 report.json이 있는 결과는 덮어쓰거나 재실행하지 않습니다. 큰 수 사례의 별도 확장 한도 실행:

```powershell
node example/c/codex_code/human_style_20261106/run.mjs --expanded-budget 45_decimal_many_allocations
```

저장된 기록만 검사·집계:

```powershell
node example/c/codex_code/human_style_20261106/inspect-process.mjs
node example/c/codex_code/human_style_20261106/summarize.mjs
```

결과와 보완점: `test-results/codex_code-results/human-style-2026-11-06/REPORT.md`

01~24는 기초·비효율 패턴, 25~44는 표현식·라이브러리·복사·메모리 조합, 45~58은 큰 수 및 동일 알고리즘/식의 구현 방식 비교, 59~64는 발견한 소스 위치 문제의 정상 실행 대조 사례입니다.
