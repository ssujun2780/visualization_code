# 실행 관계 입력 자동 연결과 현재 작업 보기 검증

2026-11-12. 요청한 세 단계(분석 입력 자동 연결 → 원본을 유지한 화면 연결 → 서로 다른 예제 실행/화면 확인)를 구현했습니다. 기존 중간언어 생성 모델과 자료구조 추론기의 판정 규칙은 이번 작업에서 변경하지 않았습니다. 전체 기존 예제 묶음은 재실행하지 않았습니다.

## 적용 계약과 공통 경로

실제로 읽은 문서는 `presentation.md`, `execution-relations.md` R-01~R-07, `execution-relations-extension.md` E-01·E-03·E-06~E-09, `execution-relations-v2.md`, `animation.md` 기본 원칙, `visualization.md` 기본 공간/연결선, `ui.md` 화면·조작입니다. 구현 범위는 [현재 작업 연결 보기](../design/work-context-view.md)에 기록했습니다.

| 설계 조항 | 변경 위치 | 검증 근거 | 상태/남은 범위 |
| --- | --- | --- | --- |
| E-01·E-03, R-02 | `scripts/animation/compiler-facts.mjs`, `work-analysis*.mjs`, 예제/세션 경로 | 기존 AST·LLVM/소스 대응만 소비. plan/trace 내용 지문 불변. 자료구조 추론 결과는 별도 입력. | 기본 자동 연결 구현. 모든 컴파일러 패턴의 경계 증명은 아님. |
| E-06b·E-07 | 컴파일 근거 수집기, v2 `work.mjs`의 선택 간선 진입/종료 | 단순 아핀 루프의 양성 검사. 본문 인덱스 변경·인덱스 주소 노출·축소 변환·복합 상한은 추측하지 않는 음성 검사. 실제 종료 분기 이후 반복 scope 없음. | 직접 1차원 아핀 범위만 증명. 일반 다차원·비선형 범위는 남음. |
| E-07·E-08, R-04 | `src/animation/work-context.js`, `work-graph.js` | WRITE 도착 전/후 값 분리. 종료 후 과거 시점으로 이동해 부분 변경 복원. 구조 대응/포인터는 당시 prefix만 사용. | 조회와 기존 시간선 연결 구현. |
| R-01·R-05 | `animation.html`, `main.js`, `canvas.js`, `style.css`, 연결 보기 | 원본 공간·코드·배열/격자·인덱스·연산 동시 관찰. 1265×712 실제 화면 확인. | 작은/중간 예제 확인. 모든 크기에서의 가독성 보장은 아님. |
| R-03 | 연결 보기 고정·원본 위치 이동·멤버 보기 | 실제 재생 버튼이 ‘일시정지’인 상태에서 고정/원본 이동. 진행 1001→1015, 두 고정 버튼 상태 true. | 검사 조작으로 재생을 멈추지 않음. |
| R-04·R-06 | 현재 범위·구조 요소 보기, 정확한 READ/WRITE 폭 | 화살표 끝점의 폭 생략을 전체 할당 접근으로 해석하지 않음. 포인터 슬롯도 실제 관찰의 offset/size 사용. 연결 구조는 현재 참조·실제 필드 값으로 표시. | 기본 연결 요소/배열/격자. 임의 구조 전용 도형은 남음. |
| E-09 | 서버 분석 Worker(8초), 브라우저 조회 Worker(준비 10초), 현재 시점 캐시·요청 합치기 | 분석 강제 시간 제한에서도 원본 기록 불변. 입력 세션/예제 API 회귀 통과. 조회 준비가 실패해도 기본 현재 접근 표시. | 하드 시간 제한/실패 격리 구현. 운영 규모 FPS/최대 메모리 보장은 아님. |
| R-07 | 공통 역할/범위/참조 경로 | 표시 판정에 파일명·함수명·변수명·특정 정답 분기 없음. 이름은 화면 라벨과 테스트 기대값에서만 사용. | 원본 규칙 유지. 구조 후보 직접 선택 UI는 후속. |

## 실행 전 고정한 예상과 실제 비교

| 예제 | 미리 고정한 예상 | 실제 결과 |
| --- | --- | --- |
| `examples/c/execution-relations/work-merge.c` | 재귀 호출은 별도 유지. 같은 data/temporary의 실제 부분 복사를 추적. 출력 `1 2 3 5 6 7 ` | 1166 사건, 두 배열 간 identity 복사 32개, 컴파일 경계 근거 2개. 최종 출력 일치. |
| `examples/c/execution-relations/work-graph.c` | 구조체 배열 내부 포인터를 실제 대상과 연결. cost 20→7, 10→9. 출력 `0 9 7` | 44 사건. 시점별 연결 요소 보기, 가중치 격자·현재 코드 동시 표시. 출력 일치. |
| `examples/c/execution-relations/work-grid.c` | 입력 세 원소를 각각 읽고 한 CALC 후 한 WRITE. 결과 17·20 | 81 사건. 두 다중 입력 CALC, 두 격자 동시 표시. 출력 `17 20`. |

입력/예상/실제 비교 코드는 `tests/animation-work-context.test.js`입니다. 원본 출력에 맞춰 예상값을 변경하지 않았습니다. 결과는 `test-results/execution-work-views/{merge,graph,grid}/recording.json`, `verification.json`에 저장했습니다. 기록에는 별도 workAnalysis를 포함하며 canonical plan/trace는 변경하지 않습니다.

## 자동 검사

관련 검사 합계 **57개 통과**(여러 집중 실행의 중복 제외):

- 새 입력/보기/시점/해시/격리: `animation-work-context.test.js` 6개.
- 기존 실행 관계 v2: `execution-relations-v2.test.js` 26개.
- 기존 중첩 선택/접기: `animation-object-selection.test.js` 8개.
- 기존 재생 경계: `animation-playback-boundary.test.js` 4개.
- 기존 전달 사건: `animation-transfer-phases.test.js` 6개.
- 예제 API·입력 세션: `animation-example-api.test.js`, `animation-input-session.test.js` 합계 7개.

API 검사의 최초 localhost 연결은 샌드박스의 EACCES로 실패했습니다. 같은 검사를 허용된 호스트 실행으로 재실행해 7개 통과했습니다. 검사를 삭제하거나 기대값을 완화하지 않았습니다. Vite production build도 통과했습니다. 기존 Monaco 청크 크기 경고는 남아 있습니다.

## 실제 화면 확인

브라우저에서 세 예제를 현재 모델로 컴파일·실행한 뒤 직접 재생했습니다. API 통과와 별도로 아래를 관찰했습니다.

- 격자: 입력 3·6·11, 결과 20, 이미 저장된 17, 원본 7행이 함께 보임. 고정 중에도 진행됨.
- 연결 구조: 원소 +0 B의 cost 0, +16 B의 cost 7, +8 B의 cost 9와 실제 연결, 가중치 격자가 함께 보임.
- 정렬: combine5에서 data/temporary의 소유자가 STACK·main임을 유지. 두 번째 WRITE 이후 data `[1,2,7,1,3,6]`을 표시하며 미실행 나머지를 최종 정렬 값으로 바꾸지 않음.
- 정렬의 끝 1166/1166에서 출력 확인 후 1016/1166으로 이동해 같은 부분 상태 복원.

화면 자료:

- `C:/Users/vespa/.codex/visualizations/2026/11/06/01a1af41-559e-7da3-b3b3-75ea41224cfe/work-grid.png`
- `C:/Users/vespa/.codex/visualizations/2026/11/06/01a1af41-559e-7da3-b3b3-75ea41224cfe/work-graph.png`
- `C:/Users/vespa/.codex/visualizations/2026/11/06/01a1af41-559e-7da3-b3b3-75ea41224cfe/work-merge.png`

## 남은 항목

일반 자동 배치, 모든 자료구조의 전용 도형, 비선형/다차원 경계 증명, 큰 구조의 부분 보기 최적화·페이지 탐색, 구조 후보 직접 선택은 미완료입니다. 현재 연결 그래프는 시점별 저장 대응과 실제 포인터를 읽는 기본 표현입니다. 분석기의 `completed`를 모든 알고리즘/의도/관계를 완전히 이해했다는 뜻으로 사용하지 않습니다.
