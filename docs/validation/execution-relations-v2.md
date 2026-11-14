# 실행 관계 v2 구현과 검증

2026-11-12. 사용자 승인 범위는 기존 실행 관계 분석기의 범용 확장·분리와 관련 공통 경로 검사입니다. **중간언어 생성 모델·자료구조 추론기·시각화 코드는 변경하지 않았습니다.** v1 기본 동작과 원본 기록을 유지하고 v2를 명시적으로 선택하도록 연결했습니다.

## 적용 계약과 변경 경로

실제로 읽은 문서는 `AGENTS.md`, `presentation.md`, `inference-model.md`, `execution-relations.md` R-01~R-07과 `execution-relations-extension.md` E-01~E-11입니다. 기존 `context/records/calls/ranges/copies/engine/result/work-context/index/worker`와 공개 IR plan/schema를 읽어 확장 경계를 확인했습니다.

변경은 `scripts/execution-relations/v2/` 10개 독립 모듈, 기존 공개 `index.mjs`의 v2 opt-in, `scripts/infer-execution-relations.mjs`의 v2/보조 입력 옵션, 관련 검사·문서입니다. 기존 v1 판정기 본문은 유지합니다. 분석 모듈의 import 경계 검사도 통과했습니다.

| 설계 조항 | 구현 위치·동작 | 실제 검증 근거 | 남은 범위 |
| --- | --- | --- | --- |
| E-01·R-02 실행 불변/분리 | common/engine, 공개 facade·독립 Worker | 원본 JSON 불변·호출자 객체 미동결·분석 폴더 외부 구현 import 금지·기존 v1 검사 | 화면/생성 경로 자동 연결하지 않음 |
| E-03~E-05 입력·정체성·v2 | common/result/index/CLI | 스냅샷 변경·다른 실행·잘못된 근거·순환 JSON 거부, 값/주소 아닌 실제 ID 사용, v1 기본·v2 별도 파일 확인 | 보조 컴파일 근거 자동 수집기 없음 |
| E-06a 접근·범위 | accesses/regions/query | 불연속 집합·직접/subtree·부분 쓰기·source/destination 분리, 실패 시도를 성공한 접근으로 세지 않음 | 알려지지 않은 메모리 효과는 미해결 |
| E-06b 경계 | bounds | stride 후보/실제 접근 분리·경계 쓰기 무효화·unsigned wrap 가능성 거부·근거 누락 격리 | 임의의 비선형 경계/새 컴파일 사실 추출 미지원 |
| E-06c 출처 | provenance/calls/result | 임시 저장·인자/반환·선택의 value/control/address 분리, float 변환과 같은 폭 정수 cast 구별, 초기화 관찰·부분 바이트·겹치는 복사 | 원본 기록에 없는 기원을 추정하지 않음 |
| E-06d 관계 조합 | work | 같은 값의 서로 다른 원소를 포함한 전달 사슬·fan-out·다중 입력·버전 순환. 비복사 덮어쓰기 뒤 잘못된 교환 요약 없음 | 알고리즘의 의도·정답 판정 없음 |
| E-06e 문맥·구조 | work/query | 실제 body-entry 근거로 for/while/do 반복을 구분, 별개 호출·반복 유지, 중첩 구조 보기·시간이 있는 노드/선언 배열 대응 | 알려지지 않은 구조 출력 형식은 대응 어댑터 필요 |
| E-07 시간·수명 | common/query/result | 전체 기록과 모든 중간 prefix의 같은 시점 조회 일치·미래 관계/종료 정보 차단·할당 주소 재사용 분리·해제 전 읽은 사본의 출처 유지 | 새 trace append 세션은 미구현 |
| E-08 조회·호환 | query/index | at/before/origins·독립 결과·v1 역사 조회 유지, 반환 전달 때 아직 살아 있는 callee 구분 | 시각화의 사건 내부 값 반영은 기존 시간선 책임 |
| E-09 예산·확장성 | common/engine/query, 정렬 범위 생산자 색인 | 깊은 호출·희소 범위·출력/간선/조회 한도, 제한 시 partial/미해결 표시 | 대규모 운영 상한 보장 아님 |
| R-01·R-03·R-05 화면 보존 | 조회 결과에 실제 지역/전역/힙·소유/생성·원본 대응 유지 | API와 원본 기록 경계만 검사 | 추가 보기·배치·동시 관찰/가독성은 이번에 구현·검증하지 않음 |

## 실행한 관련 검사

```powershell
node --test tests/execution-relations-scaffold.test.js tests/execution-relations-rules.test.js tests/execution-relations-quicksort.test.js tests/execution-work-context.test.js tests/execution-relations-v2.test.js
```

**53개 통과, 실패 0개.** 기존 v1 관련 27개와 신규 v2 26개입니다. 기존 예제 전체 모음·UI 검사·프런트엔드 빌드는 실행하지 않았습니다. 기존 관련 검사는 자신이 사용하는 소수의 고정된 C fixture를 생성/조회하는 기존 동작을 유지합니다.

신규 검사는 직접 구성한 관찰 계약과 별도 저장된 실제 산술·함수 IR을 사용합니다. 읽기/쓰기 범위·출처·순서·생명주기·성립 시점을 기대값으로 먼저 고정했습니다. 실패했던 전체/prefix 관계 ID 불일치는 사실 근거 기반 ID와 prefix별 다중 원본 누적으로 수정했고, 검사를 삭제하거나 비교를 약하게 만들지 않았습니다. 공유 내부 관찰 ID는 여러 정규 사건 소유자를 보존하도록 일반화했습니다.

CLI 검사는 임시 폴더의 plan/trace/v1 결과가 바뀌지 않고 `execution-relations-v2.json`만 추가되는지 확인합니다. 테스트의 재귀 정리는 자신이 만든 임시 폴더의 절대 경로·부모·접두사를 확인한 뒤 수행합니다.

추가로 기존에 저장된 회의 정렬·quicksort 기록에 v2 분석/조회가 가능한지 확인했습니다. 이는 두 알고리즘의 모든 출처나 올바른 동작을 새로 보증한 검사가 아닙니다. 관찰이 부족한 출처는 해당 노드와 진단에 남깁니다.

## 규모 확인

최종 관련 검사 실행에서의 Node 분석+조회 측정입니다. 여러 테스트 파일이 함께 실행된 환경의 참고값이며 C 실행 시간이나 화면 배선/렌더링 시간은 아닙니다.

| 합성 관찰 규모 | 결과 관계 수 | 분석+조회 |
| --- | ---: | ---: |
| 깊이 1,200 호출, 사건 3,602개 | 6,005 | 약 467ms |
| 희소 원소 100개, 사건 303개 | 1,400 | 약 107ms |
| 희소 원소 1,000개, 사건 3,003개 | 14,000 | 약 799ms |

깊은 호출을 JavaScript 재귀로 순회하거나 각 부모에 모든 자식 사건을 복사하지 않습니다. 정렬된 생산자 범위에서 필요한 겹침만 조회하고, 현재 scope의 접근 집합은 prefix 캐시를 사용합니다. 임의의 밀집 의존 그래프에서 항상 선형이라고 주장하지 않습니다.

## 명시적인 남은 항목

- 컴파일 근거의 자동 수집·내보내기와 임의의 비선형 영역 증명.
- 알려지지 않은 자료구조 추론 결과 형식의 저장/시간 대응 어댑터.
- 새 trace append를 위한 증분 분석 세션과 운영 규모의 예산 조정.
- 시각화 연결·추가 보기 배치·실제 재생 중 동시 가독성 확인.

이 항목은 정상 결과로 꾸미지 않습니다. 현재 API의 capabilities/coverage/unresolved와 [구현 문서](../design/execution-relations-v2.md)를 함께 확인합니다.
