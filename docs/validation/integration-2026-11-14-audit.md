# 통합 검사 감사 목록

## 검증 상태

- 전체 정식 테스트 1회: 1,231건 중 1,187건 통과, 44건 실패, 생략 0건. 실행 시간 약 13분입니다.
- 이후 수정 계약 검사: 41건 모두 통과. 별도 읽기 전용 바인딩 검사에서도 4건의 추가 성공을 확인했습니다.
- 최초 실패 중 25건은 위 재검사에서 통과했습니다. 아래 19건은 미해결 또는 추가 재검토 대상입니다. 전체 테스트를 다시 반복한 결과로 보고하지 않습니다.
- 모델·추론 결과 자체를 바꾸거나 기대값을 실제 결과에 맞춰 수정해 통과시키지 않았습니다. 현재 작업 전체를 저장·병합하는 것과 테스트 전체 통과를 구별합니다.

| 검사 | 위치 | 관측된 실패 |
| --- | --- | --- |
| copied scalar comparisons and pointer-based exchange preserve equal writes and empty recursive spans | [ir-array-work.test.js](../../tests/ir-array-work.test.js) | /- Expected values to be strictly equal: 0 !== 3 |
| VLA shapes use the frozen observed stride and keep slice extents | [ir-followup-model.test.js](../../tests/ir-followup-model.test.js) | /- The expression evaluated to a falsy value: assert.ok(arrays.some(a=>a.range.offset===20&&a.geometry.dimensions[0]===1)) |
| relation coverage stays stable under repeated reads and preserves explicit projections | [ir-inference-common-boundaries.test.js](../../tests/ir-inference-common-boundaries.test.js) | /- Expected values to be strictly equal: 1 !== 3 |
| counted adjacency ignores capacity and expires on a changed count | [ir-inference-common-overlays.test.js](../../tests/ir-inference-common-overlays.test.js) | /- Expected values to be strictly equal: true !== false |
| early exit is not evidence for a complete active prefix | [ir-inference-common-overlays.test.js](../../tests/ir-inference-common-overlays.test.js) | /- The expression evaluated to a falsy value: assert.ok(!state(s,t).logicalTopology?.complete) |
| parallel endpoints and properties survive helper results, invalidate writes and retain ended property history | [ir-inference-readonly-regressions.test.js](../../tests/ir-inference-readonly-regressions.test.js) | /- The expression evaluated to a falsy value: assert.ok(last.edges.some(e=>e.fromIndex===2&&e.toIndex===1&&e.status==='observed')) |
| bounded index walks and presence matrices provide graph proofs independent of algorithm names | [ir-inference-readonly-regressions.test.js](../../tests/ir-inference-readonly-regressions.test.js) | /- Expected values to be strictly equal: 12 !== 4 |
| a pointer to a later row keeps absolute cell coordinates and relative callee bounds | [ir-multidimensional-work.test.js](../../tests/ir-multidimensional-work.test.js) | /- Expected values to be strictly deep-equal: + actual - expected [ [ - 1, 0, + 0 ], [ + 0, 1, - 1 ], [ + 0, - 1, 2 ], [ + 0, - 1, 3 ], [ + 1, - 2, 0 ], [ - 2, 1, + 1 ], [ + 1, 2, - 2 ], [ + 1, - 2, 3 ] ] |
| bounded relation history is incomplete instead of reusing the final retained state | [ir-priority-partition-range.test.js](../../tests/ir-priority-partition-range.test.js) | /- Expected values to be strictly equal: + actual - expected + undefined - true |
| pointer selection follows current nodes while direct NULL slots, emptied roots and arrays remain selectable | [ir-recommendation-scope.test.js](../../tests/ir-recommendation-scope.test.js) | /- The expression evaluated to a falsy value: assert.ok(!emptied.some(r=>r.representedNodeCount>0)) |
| record vectors connect parent values within active length and exclude temporary copies | [ir-record-index-views.test.js](../../tests/ir-record-index-views.test.js) | /- Expected values to be strictly equal: 0 !== 1 |
| owned index arrays use shared observed values without cache hits or merging identical container types | [ir-record-index-views.test.js](../../tests/ir-record-index-views.test.js) | /- Expected values to be strictly equal: 0 !== 2 |
| bounded reconstruction preserves partial coverage instead of expanding capacity | [ir-record-index-views.test.js](../../tests/ir-record-index-views.test.js) | /- The expression evaluated to a falsy value: assert.ok(r.graphs.length) |
| equal or transformed values used in unrelated storage never establish a container edge | [ir-record-index-views.test.js](../../tests/ir-record-index-views.test.js) | /- Expected values to be strictly equal: + actual - expected + 'fault' - 'completed' |
| multiply and assignment lazy tags retain distinct operations, clearing and actual stale children | [ir-structure-boundaries.test.js](../../tests/ir-structure-boundaries.test.js) | /- The expression evaluated to a falsy value: assert.ok(s) |
| validators reject altered memberships, neutral values and presence markers | [ir-structure-boundaries.test.js](../../tests/ir-structure-boundaries.test.js) | "Cannot read properties of undefined (reading 'states')" |
| shifted-prefix storage recognizes FIFO and LIFO independently of field names | [ir-structure-diversity-fixes.test.js](../../tests/ir-structure-diversity-fixes.test.js) | /- Expected values to be strictly deep-equal: + actual - expected [ + 'active-prefix' - 'fifo' ] |
| No6 access types and source operators preserve prefix/postfix routing and one target evaluation | [ir-update-metadata.test.js](../../tests/ir-update-metadata.test.js) | /- Expected values to be strictly equal: '5' !== '7' |
| the same automatic path observes the unchanged 900-line C11 regex program | [model.test.js](../../tests/model.test.js) | /- [{"code":"structure-inference-time-limit","scope":"visualization-only","message":"자료구조 추론 시간 제한에 도달했습니다."}] + actual - expected + 'limited' - 'completed' |

## 저장된 근거

`test-results/integration-release/tests-scoped.log`, `final-contracts.log`, `repaired-contracts.log`, `build-final.log`에 실제 결과가 있습니다. 실행 로그는 기존 제외 규칙에 따라 Git에 포함하지 않습니다. 과거 예상 해시는 별도 압축 fixture로 보존합니다.

실제 브라우저의 1배속 가독성 검증은 이번 Git 통합 작업에서 새로 수행하지 않았습니다.
