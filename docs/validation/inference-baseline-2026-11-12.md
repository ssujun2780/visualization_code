# 추론 기준 커밋

2026-11-12. 누적된 독립 추론기·관련 검사·문서를 별도 브랜치에 저장합니다. 새 자료구조 기능을 추가하는 작업이 아닙니다.

읽은 계약은 `presentation.md`의 모델 경계, `inference-model.md`의 독립 API·읽기 전용 입력, `structure-presentation-policy.md`의 추천·사용자 지정 우선, RC-07 및 `design-implementation-template.md`입니다.

| 조항 | 저장하거나 보완한 위치 | 검증 근거 | 남은 범위 |
| --- | --- | --- | --- |
| 생성·추론 분리 | `scripts/inference`, `scripts/shared`, `scripts/pipeline`, 독립 CLI; 기존 생성 경로의 추론 호출·검증 제거만 선별 | 별도 체크아웃의 분리 검사 6개: 의존성·원본 불변·Worker·파이프라인·CLI | 다른 세션의 생성 모델 수정은 작업 폴더에 유지 |
| RC-07 및 공통 한도 | 이력·근거 한도, 조건·추천·저장 대응과 관련 검사 | 이력 검사 8개 및 한도·통합 검사 23개 통과 | 모든 규모의 성능·추론 완전성을 뜻하지 않음 |
| 실제 소비부 연결 | 독립 `scripts/execution-relations` 및 저장 대응 통합 검사 | 같은 23개 검사에 실제 추론→실행 관계 연결 및 새 C 혼합 사례 포함 | UI 연결·화면 가독성은 별도 작업 |
| 독립 기대값과 재현성 | `tests/fixtures/inference-records`, `tests/helpers/frozen-inference.mjs`; 경계 검사 사전 기대값과 필수 예제 소스 | 기존 11개 실행 기록을 내용 변경 없이 압축, 소스·실행 해시와 기존 출력 기대값 확인 | 고정 기록 재생과 현재 생성 모델의 새 실행 검사를 구별 |

## 커밋 대상 자체의 검사

인덱스에 준비한 파일만 `git checkout-index`로 별도 폴더에 추출했습니다. 해당 폴더에는 기존 `test-results`를 복사하지 않았습니다. 필수 상대 모듈 경로가 모두 존재하는지도 확인했습니다.

```sh
node --test --test-concurrency=2 tests/inference-separation.test.js tests/ir-inference-history-gap.test.js tests/ir-inference-limits-integration.test.js
```

37개 통과, 실패·생략 0개입니다. 소요 시간은 약 17초였으며 전체 예제 재검사는 하지 않았습니다. 기존 구현 단계의 121개 관련 검사 기록과 이번 커밋 검사는 서로 다른 검사 범위입니다. 기존 기록은 `inference-limits-integration-2026-11-12.md`를 참고합니다.

생성 모델의 연산·평가 순서·최종 결과 전달 수정, 입력 대기·애니메이션·UI 및 UI 의존성은 이번 커밋에서 제외합니다. 생성 경로에서 선택한 변경은 이미 구현된 추론 분리뿐입니다. 작업 폴더의 나머지 변경을 삭제하거나 되돌리지 않습니다.

고정 입력 저장 경로와 새 폴더 생성 처리를 보완했으며, 소스에서 정한 기대값과 판정 조건은 변경하지 않았습니다. 압축 입력은 Git의 줄바꿈 변환에 영향받지 않게 보존합니다. 자동 생성된 전체 `test-results`는 계속 제외합니다.
