# 배열 감사의 과거 실행 기록

2026-11-10 감사에서 남긴 원본 `plan.json`·`trace.json`을 압축한 자료입니다. 새 생성 모델의 결과로 예상 해시를 갱신한 자료가 아닙니다.

통합 시 `example/c/codex_code/array-inference-audit-2026-11-10/expected.json`의 기존 `coreSha256` 네 항목(events, objects, frames, resultDeliveries)이 각 원본 기록과 모두 일치함을 확인했습니다. 소스 스냅샷도 해당 예제 파일과 일치합니다.

`ir-array-membership.test.js`는 이 과거 기록의 호환성·불변성과, 현재 생성 모델의 실제 실행·독립 예상 관계·읽기 전용 추론을 각각 검사합니다. 생성 모델에 추가된 정식 명령·메타데이터를 과거 전체 JSON 해시와 혼동하지 않습니다. 기존 예상 출력·역할·활성 원소·순서·해시 값은 변경하지 않았습니다.
