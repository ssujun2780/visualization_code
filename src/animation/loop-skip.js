// Navigation over observed iterations of one activation of one loop only.
// The destination is an existing event boundary; playback applies its effects.
export function loopSkipContext(groups,index){
  const group=groups.groupAt(index),loop=group?.kind==='iteration'?group.loop:group?.kind==='loop'?group:null;
  if(!loop)return null;
  let lo=0,hi=loop.iterations.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(loop.iterations[mid].end<=index)lo=mid+1;else hi=mid;}
  return {loop,first:lo,remaining:loop.iterations.length-lo};
}

export function loopSkipDestination(groups,index,count=1){
  if(count!=='all'&&(!Number.isSafeInteger(count)||count<1))throw new RangeError('건너뛸 반복 횟수는 양의 정수 또는 all이어야 합니다.');
  const context=loopSkipContext(groups,index);if(!context)return null;
  const {loop,first,remaining}=context,skipped=count==='all'?remaining:Math.min(count,remaining);
  // At the last recorded iteration include the final false condition and
  // loop cleanup too. Never continue into another invocation or outer loop.
  return {...context,skipped,target:skipped===remaining?loop.end:loop.iterations[first+skipped-1].end};
}
