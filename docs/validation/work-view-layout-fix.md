# 작업 보기 배치 보완

2026-11-12. 사용자가 대규모 포인터 연결망 화면에서 가려짐·겹침을 발견했습니다. 이전의 작은 세 예제 검사만으로 밀집 화면의 가독성을 충분히 확인하지 못했습니다. 이번 변경은 UI·카메라의 보기 선택에 한정합니다. 중간언어 생성 모델·자료구조 추론기·실행 관계 판정 규칙은 변경하지 않았습니다.

적용 계약: 실제 읽은 `presentation.md`, `animation.md` 기본 원칙, `visualization.md` 공간·연결, `ui.md` 조작, `execution-relations.md` R-03~R-05, `work-context-view.md` 표현/시점 절입니다.

| 설계 조항 | 공통 변경 위치 | 검증 근거 | 남은 범위 |
| --- | --- | --- | --- |
| R-05 공간과 데이터의 동시 가시성 | `workspace-layout.js`, `work-context.css`, `animation.html` | 같은 40/3245에서 Canvas 120→약197px, 보조 보기 300→200px. 보조 보기 접으면 Canvas 약405px. | 큰 배열/밀집 구조의 일반 자동 배치는 별도. |
| UI 조작 / R-03 | 독립 카메라 행·조작법·상태 행, 접기/상하 분할선 | Canvas 안의 조작부/안내/상태 DOM 4종이 모두 외부에 있음. 분할선 방향키/Home·접기/열기 직접 확인. 재생 중 접었을 때 버튼은 ‘일시정지’, 이후 실제 진행 174까지 확인. | 작은 창에서는 페이지/내부 스크롤을 사용. |
| R-04·R-05 정확한 칸과 값 | `work-context.css`, `work-context.js` | 기존 폭47px/높이164px 포인터 칸 → 약85~89px/61px. 값이 자신의 칸을 넘는 항목 0개. 가로 스크롤 및 ⋯로 부가 정보 분리. | 한 번에 모든 큰 배열 원소를 펼치지 않음. |
| 애니메이션 동일 시간선 | 보조 보기의 `drawFlow` | 글자 위 SVG 대신 별도 전달 줄. 기존 `transferPresentation`의 edges·active·progress·groupOpacity 사용. 기존 전달 사건 6개 검사 통과. | 원본 공간의 전달/포인터 배선 알고리즘은 변경하지 않음. |
| R-04 WRITE 표시 | `currentWorkView`, 기존 공통 보기 검사 | 실제 WRITE.value와 도착 시점 표시. 이전 인덱스 CALC의 결과가 저장값으로 보이지 않음. 각 예제의 실제 쓰기 값/장면 값과 비교. | 복사/출력처럼 scalar value가 없는 명령에 가상 숫자를 만들지 않음. |
| R-05 현재 작업 이동 | `canvas.js` `focusEvent`, `animation-focus-range.test.js` | 큰 할당 전체가 아닌 접근 칸 확대. 접힌 경우 대표 컨테이너 선택. 순수 검사 2개 및 40/3245 실제 클릭으로 약81%에서 현재 구조체 멤버 관찰. | 자동 카메라 추적을 추가하지 않음. |

## 검사

- `animation-work-context.test.js` 6개, `animation-focus-range.test.js` 2개, `animation-transfer-phases.test.js` 6개: **관련 14개 통과**.
- Vite production build 통과. 기존 Monaco 큰 청크 경고는 남아 있습니다.
- 기존 전체 C 예제 묶음은 재실행하지 않았습니다. 기존 정렬/연결 구조/격자 공통 보기 검사와 문제 재현용 pointer-network를 사용했습니다.
- 실제 브라우저 1265×712의 `pointer-network`, **40/3245**를 이전 상태와 비교했습니다. 주어진 첨부 화면과 같은 진행 위치입니다. API 통과와 화면 확인을 구분했습니다.
- 최종 DOM 측정: Canvas clientHeight 197, 보조 보기 clientHeight 199, 값의 칸 경계 초과 0, Canvas 내부 조작부/안내 0.

화면: `C:/Users/vespa/.codex/visualizations/2026/11/06/01a1af41-559e-7da3-b3b3-75ea41224cfe/work-view-pointer-network-fixed.png`

이 검사는 지적된 겹침과 공간 배분 보완의 근거입니다. 모든 그래프·알고리즘·화면 크기에서 한눈에 이해된다는 보장은 아닙니다. 큰 저장소의 내부 스크롤과 기존 무한 공간 이동은 유지합니다.
