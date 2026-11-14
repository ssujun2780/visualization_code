import {inputContext,output,collector,check} from './common.mjs';
import {accessIndex} from './accesses.mjs';
import {buildProvenance} from './provenance.mjs';
import {frameTree,observedRegions} from './regions.mjs';
import {workIndex,transferRelations,structureRelations} from './work.mjs';
import {analyzeBounds} from './bounds.mjs';
import {callLinks} from './calls.mjs';
import {failure,validateV2} from './result.mjs';

export function analyzeV2(plan,trace,options={}){
  const scope={programId:typeof plan?.programId==='string'?plan.programId:null,runId:typeof trace?.runId==='string'?trace.runId:null};
  if(!plan||!trace)return failure(scope,{code:'execution-records-unavailable',message:'실행 기록이 없어 분석하지 않았습니다.'},'skipped');
  let c;try{c=inputContext(plan,trace,options);}catch(error){return failure(scope,error);}
  let result;try{result=output(c);}catch(error){return failure(scope,error);}
  const emit=collector(c,result),events=c.trace.events.slice(0,c.limits.maxEvents),stageResults=new Map();
  result.coverage.analyzedEventCount=events.length;result.coverage.analyzedThroughExecutionId=events.at(-1)?.eventId??null;
  if(events.length<c.trace.events.length)emit.truncate('maxEvents',events.at(-1)?.eventId);
  const stages=[
    {id:'accesses',requires:[],run:()=>accessIndex(c,events,emit)},
    {id:'calls',requires:[],run:()=>frameTree(c,events)},
    {id:'call-links',requires:['calls'],run:()=>callLinks(c,events,emit)},
    {id:'provenance',requires:['accesses','call-links'],run:()=>buildProvenance(c,events,stageResults.get('accesses'),stageResults.get('call-links'),emit,result)},
    {id:'regions',requires:['accesses','calls'],run:()=>observedRegions(c,events,stageResults.get('accesses'),stageResults.get('calls'),emit)},
    {id:'work',requires:['calls'],run:()=>workIndex(c,events,stageResults.get('calls'),emit)},
    {id:'transfers',requires:['provenance','accesses','work'],run:()=>transferRelations(c,events,stageResults.get('provenance'),stageResults.get('accesses'),stageResults.get('work'),emit)},
    {id:'bounds',requires:[],run:()=>analyzeBounds(c,events,emit,result)},
    {id:'structures',requires:['accesses'],run:()=>{const mapped=structureRelations(c,stageResults.get('accesses'),emit);if(!mapped||!mapped.bindings&&!mapped.arrays)result.capabilities.structures={status:'unavailable',reason:'missing-temporal-storage-bindings'};return mapped;}}
  ];
  for(const stage of stages){if(emit.expired){result.capabilities[stage.id]={status:'unavailable',reason:'analysis-budget'};continue;}const missing=stage.requires.filter(id=>!stageResults.has(id));if(missing.length){result.capabilities[stage.id]={status:'unavailable',reason:'dependency-failed',dependencies:missing};result.status='partial';continue;}
    const length=result.relations.length,changeLength=result.changes.length;
    try{const value=stage.run();stageResults.set(stage.id,value);result.capabilities[stage.id]??={status:emit.expired?'partial':'completed'};}
    catch(error){result.relations.length=length;result.changes.length=changeLength;result.capabilities[stage.id]={status:'failed',reason:error.code??'analysis-stage-failed'};
      emit.issue(error.code??'analysis-stage-failed',{passId:stage.id,message:error.message});result.status='partial';}
  }
  const work=stageResults.get('work');if(work)for(const r of result.relations)if(!r.workScopeIds.length)r.workScopeIds=[...work.byEvent.get(r.availableAtExecutionId)??[]];
  if(result.capabilities.work?.status==='completed')result.capabilities.work.iterations=c.compilerFacts?.regions?.some(r=>r.kind==='loop')?'compiler-regions':'unavailable';
  result.coverage.unresolvedValueCount=result.provenance.nodes.filter(n=>n.unresolved.length).length;
  try{return validateV2(c,result,{verifyOptional:true});}catch(error){return failure(scope,error);}
}
