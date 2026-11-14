// Per-analysis budget diagnostics; never global state or execution errors.
export function inferenceLimits(options={}){
  const limits={maxStates:2048,maxOriginDepth:64,maxDependencyNodes:8192,...options};
  for(const [name,value]of Object.entries(limits))if(!['maxStates','maxOriginDepth','maxDependencyNodes'].includes(name)||!Number.isSafeInteger(value)||value<1)
    throw new RangeError(`추론 한도 ${name}는 양의 정수여야 합니다.`);
  return limits;
}
export function createInferenceBudget(options={}){
  const limits=inferenceLimits(options),issues=new Map();let stage='unknown';
  return {limits,setStage:name=>{stage=name;},report(resource,limit,executionId=null){
    const key=`${stage}:${resource}`,old=issues.get(key);
    if(old){old.occurrences++;return;}
    issues.set(key,{code:'structure-inference-limit',stage,resource,limit,firstExecutionId:executionId,occurrences:1,scope:'visualization-only'});
  },diagnostics:()=>[...issues.values()]};
}
export function historyDiagnostics(structures){
  return structures.flatMap(s=>{
    const losses=new Map(Object.entries(s.coverage??{}).filter(([k,v])=>/^omitted/.test(k)&&typeof v==='number'&&v>0||k==='truncated'&&v===true)
      .map(([resource,count])=>[resource,{count,first:s.coverage.historyGapFromExecutionId??s.coverage.firstOmittedProofExecutionId??null}]));
    for(const st of s.states??[])for(const [resource,count]of Object.entries(st))if(/^omitted/.test(resource)&&typeof count==='number'&&count>0){
      const old=losses.get(resource);if(old)old.count=Math.max(old.count,count);else losses.set(resource,{count,first:st.afterExecutionId??st.executionId});
    }
    return [...losses].map(([resource,{count,first}])=>({code:'structure-inference-limit',resource,structureId:s.id,omitted:typeof count==='number'?count:null,firstExecutionId:first,
      ...(resource==='omittedStates'&&Number.isSafeInteger(s.coverage?.maxStates)?{
        limit:s.coverage.maxStates,retainedStates:s.states?.length??0,
        historyGapFromExecutionId:s.coverage.historyGapFromExecutionId??null,
        historyGapToExecutionId:s.states?.at(-1)?.afterExecutionId??s.states?.at(-1)?.executionId??null}:{}),scope:'visualization-only'}));
  });
}
