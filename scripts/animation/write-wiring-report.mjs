import {readFile, writeFile, mkdir} from 'node:fs/promises';
const base = new URL('../../test-results/pointer-wiring/', import.meta.url);
const benchmark = JSON.parse(await readFile(new URL('benchmark.json', base), 'utf8'));
const real = JSON.parse(await readFile(new URL('real-c-results.json', base), 'utf8'));
const table = [];
for (const initial of benchmark.rows.filter(r => r.phase === 'initial')) {
  const rows = benchmark.rows.filter(r => r.count === initial.count && r.mode === initial.mode), delta = rows.find(r => r.phase === 'repoint-1pct');
  const warm = rows.filter(r => r.phase === 'unchanged').map(r => r.milliseconds).sort((a,b)=>a-b);
  table.push(`| ${initial.count} / ${initial.regions} | ${initial.mode} | ${initial.milliseconds.toFixed(1)} | ${delta.milliseconds.toFixed(1)} | ${warm[2].toFixed(3)} | ${(delta.unchangedPathFraction * 100).toFixed(1)}% | ${initial.quality.overlaps} | ${initial.auditMilliseconds.toFixed(1)} |`);
}
const ctable = [];
for (const id of [...new Set(real.map(r => r.example))]) {
  const rows = real.filter(r => r.example === id), max = key => Math.max(...rows.map(r => r[key]));
  ctable.push(`| ${id} | ${rows[0].traceEvents} | ${rows[0].peakReferences} | ${rows.length} | ${max('missing')} | ${Math.max(...rows.map(r => r.quality.nodeCrossings))} | ${Math.max(...rows.map(r => r.quality.overlaps))} | ${max('milliseconds').toFixed(1)} |`);
}
const text = `# 포인터 배선 검증 결과

생성: ${new Date().toISOString()} / ${benchmark.platform} / ${benchmark.runtime}

## 배선 단독 부하

컴파일·중간언어 생성·재생 상태 구축·WASM 최초 로드는 제외한다. 브라우저와 동일하게 전체 교차 통계를 배선 시간 밖에서 별도 측정한다. 초기 배선과 변경 갱신은 각 1회 관측값이며 보장 시간이 아니다. 변경 없는 그래프는 5회 중앙값이다. mesh는 순열 기반 연결, fan은 한 상자로 모이는 집중 연결이다. 1% 갱신은 최소 1개 선을 바꾼다.

| 연결 수 / 영역 수 | 배치 | 초기 ms | 1% 재연결 ms | 변경 없음 ms | 기존 경로 유지 | 초기 긴 겹침 수 | 별도 초기 품질 감사 ms |
|---|---|---:|---:|---:|---:|---:|---:|
${table.join('\n')}

모든 합성 시험(초기·무변경·재연결·상자 이동·삭제)에서 미배선과 상자 관통은 0이었다. 1,000개에서는 일부 평행 겹침이 남는다. 8 단위 이하의 공통 끝점 구간은 겹침 집계에서 제외한다. 수직·수평 교차는 겹침과 별개로 JSON에 집계한다. 조밀한 통로의 차선 간격은 화면에서 작아질 수 있다. 가독성의 최적해를 보장하지 않는다.

## 실제 C → 중간언어 → 배선

현재 예제 API와 같은 traceModel을 사용한다. 각 프로그램 전체를 정상 실행한 뒤, 포인터 증가·함수 호출·해제 전후·최대 연결 시점을 선택해 배선한다. 모든 재생 경계를 전수 검사한 결과는 아니다. C 예제에는 일반·이중·삼중 포인터, 포인터 배열, 다차원 배열 포인터, 구조체 내부 포인터 배열, 구조체 배열, 바이트 복사, 전역 초기값, 함수 인자, 재연결·NULL·할당·해제가 포함된다. 아래 시간은 전체 품질 감사도 포함한다.

| 예제 | 사건 수 | 최대 참조 | 배선 검사 시점 | 최대 미배선 | 최대 상자 관통 | 최대 긴 겹침 | 최대 감사 포함 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
${ctable.join('\n')}

과거 시점으로 이동하면서 영역이 다시 생기는 경우도 포함한다. native 연결점 상태의 복구 횟수는 real-c-results.json의 repairedRoutes에 남는다. 품질 검사는 CPU에서 수행하며, 브라우저의 별도 작업자 전송·렌더링 비용을 위 시간에 포함하지 않는다.

## 별도 추론 오류

pointer-network-index-formulas.c는 정상 C 코드지만 자료구조 추론 검증의 index-tree 범위 검사에서 중간언어 생성이 중단된다. model-index-formulas-failure.json과 원본 C를 보존했다. 배선 엔진 성공 사례에 포함하지 않는다. 화면용 pointer-network.c는 곱셈 형태의 인덱스 대신 순환 오프셋을 사용하는 별도 연결 패턴이다. 이 변경으로 추론 모델을 고쳤다고 주장하지 않는다.

## 재현

프로젝트 루트에서 Node가 PATH에 있는 환경:

~~~powershell
node scripts/animation/benchmark-wiring.mjs
node scripts/animation/verify-pointers.mjs
node scripts/animation/write-wiring-report.mjs
node --test tests/animation-pointer-wiring.test.js tests/animation-memory.test.js
~~~

브라우저: animation.html의 예제 메뉴에서 포인터 관련 3개 예제를 선택한다. 실행 기록 목록에서 원하는 사건을 선택하고 전체 보기·확대·드래그로 탐색한다. 선택된 상자와 연결된 선, 커서를 올린 선을 강조한다.
`;
await writeFile(new URL('REPORT.md', base), text);
const documentation = new URL('../../docs/validation/', import.meta.url);
await mkdir(documentation, {recursive: true});
await writeFile(new URL('pointer-wiring.md', documentation), text);
console.log('test-results/pointer-wiring/REPORT.md');
