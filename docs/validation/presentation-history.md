# 탐색 경로와 무관한 객체 배치·포인터 배선

후속: 수동 이동까지 전체 표시 이력을 초기화하던 부분은 [국소 배치 수정](presentation-local-edits.md)으로 대체했습니다. 아래 수치는 최초 검증 시점의 기록이며, 현재 누적 검사 결과는 후속 문서를 따릅니다.

2026-11-13. 승인 범위는 정상 재생, 반복/명령/행 건너뛰기, 이전 이동과 슬라이더 탐색의 표시 일치입니다. 중간언어 생성 모델과 자료구조/실행 관계 추론 알고리즘은 수정하지 않았습니다. 기존 `applyEvent`를 읽기 전용으로 사용하는 표시 소비 경로를 추가했습니다.

읽은 계약: `presentation.md`, `prepared-scene.md` PS-01~04, `loop-navigation.md` L-01·04·05·06, `pointer-wiring.md` 경로 보존/실패 처리, `moving-tools.md` T-01~04, `animation.md`, `visualization.md`, `ui.md`. 새 표시 재현 계약은 PS-06으로 정리했습니다. PS-05 공유 저장 형식과 구별합니다.

## 설계 대응

| 조항 | 공통 변경 위치 | 검증 근거 | 상태·남은 항목 |
| --- | --- | --- | --- |
| PS-06 원본 순서로 표시 준비 | `presentation-history.js` | 같은 사건 순서로 배치·도구·증분 라우터 진행. 콜드 점프/과거 이동/다시 앞으로 이동의 전체 좌표·통로·경로 점을 엄격 비교 | 정상 재생과 탐색이 같은 이력 소비 |
| PS-02·06 저장 비용/수명 | `presentation-journal.js` | 변경된 좌표·선만 저장. 128버전마다 최대 16개 체크포인트. 오래된 체크포인트 제거 뒤 원점·변경 이력 복원 검사 | 376사건: 754개 전후 버전, 변경 항목 931개, 체크포인트 6개. 대규모 최악 비용 검증은 별도 |
| L-05·06 탐색 경계 | `pointer-client.js`, `pointer-worker.js`, `canvas.js`, `main.js` | 건너뛰어도 표시 준비를 같은 순서로 수행, 되감기는 저장된 경로를 읽음. 재생 상태 자체는 기존 seek/applyEvent 사용 | 원본 C/추론 재실행 없음 |
| 기존 배선 보존/국소 복구 | 같은 Worker 및 기존 `PointerWiring` 재사용 | 통로 슬롯·차선·local corridor 최대 2회 복구 포함. 실제 원본 포트에 도착하는 경로 검사, 기존 배선 회귀 | 드래그 미리보기와 이력 라우터 분리 |
| 사용자 보기 설정 | `world.js`, `pointer-client.js` | 고정 좌표·접기·크기·표현 변경은 새 구성. 카메라 이동/선택은 배선을 재계산하지 않음. 소수 픽셀 잡음, 옛 Worker 응답, 중복 응답 검사 | 같은 기록/보기/정수 픽셀 화면 크기에서의 일치. 사용자가 카메라를 달리한 화면의 픽셀 일치는 요구하지 않음 |
| 준비 완료 장벽 | `canvas.js`, `main.js` | 탐색 직후 aria-busy 즉시 갱신. 이전 완료 캔버스를 유지하고 새 장면은 준비 후 그림. 화면 맞춤/현재 작업 요청은 준비 뒤 처리 | 최초의 큰 점프는 Worker 이력 준비를 기다릴 수 있음 |
| 기존 자료구조·강조 | 기존 prepared 결과·원본 범위 사용 | 준비된 연결 리스트, 포인터 배열, 중첩/접기, 트리 연결선·일반 포인터 스타일 관련 회귀 | 추론 결과를 바꾸거나 새 구조 판정하지 않음 |

## 검증

`test-results/presentation-history/focused-tests.log`: **37개 통과, 실패·건너뜀 0개**. 전체 과거 C 예제를 실행하지 않았습니다. 관련 파일은 다음과 같습니다.

```text
tests/animation-presentation-history.test.js
tests/animation-pointer-wiring.test.js
tests/animation-object-selection.test.js
tests/animation-loop-skip-count.test.js
tests/animation-playback-boundary.test.js
tests/animation-tree-edge-contrast.test.js
tests/animation-pointer-appearance.test.js
```

새 실제 C 기록은 함수 호출/재귀, 지역 배열의 생성·정리, 포인터 배열·구조체의 순환 연결, calloc/realloc/free와 값 변경을 포함합니다. 순차 이력과 독립된 콜드 점프 이력을 비교하고, 과거 조회가 라우터를 다시 진행하지 않는 것도 검사했습니다. 원본 실행 기록의 JSON 불변을 확인했습니다. `recording.json`, `report.json`은 같은 결과 폴더에 있습니다.

빌드 통과(`build.log`). 기존 편집기 큰 청크 경고는 유지됩니다. 최신 공유 prepared 형식은 실행 ID/사건 수 검증 전에 복원하도록 화면 입력 경계를 맞췄습니다. 저장 형식의 내용이나 추론 결과를 바꾸지 않습니다.

화면 검증은 실제 376사건 기록과 그 추론/준비 결과로 수행했습니다. 새로 불러온 기록에서 313/376으로 직접 이동한 장면, 끝까지 이동한 뒤 313으로 복원한 장면, 처음부터 10배속으로 376까지 정상 재생한 뒤 313으로 돌아온 장면을 대조했습니다. 같은 카메라에서 i=5, 노드 값 6·9, 알루 i<5, 연결선 배치가 유지됩니다. 마지막에는 속도를 1배속으로 복원했습니다. 실제 그리기 완료 위치 `data-presentation-cursor=313`, `aria-busy=false`도 확인했습니다. 근거는 같은 결과 폴더의 `native-checks.json`, `history-normal.png`, `history-rewind.png`입니다. 화면 전체에는 코드/명령 목록 스크롤 차이가 있으므로 픽셀 해시 일치를 근거로 사용하지 않습니다. 좌표와 경로 점의 정확한 일치는 위 자동 검사가 담당합니다.

남은 범위: 서로 다른 보기 구성 사이의 배치를 같다고 보장하지 않습니다. 드래그 중에는 즉시 미리보기를 사용하고 놓은 뒤 해당 고정 설정의 이력을 준비합니다. 대규모 기록/고밀도 포인터망의 준비 시간·메모리 상한, 모든 C 코드의 완전한 지원, No43 전체 재검증은 이번 완료 항목이 아닙니다.
