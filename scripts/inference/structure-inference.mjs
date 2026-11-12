// Optional visualization consumer. The execution plan and trace are finalized
// before entry. Builders may only write their own bindings and derived metadata.
import {validateStructureTrace} from './structure-schema.mjs';
import {bindArrayStructures,arrayStructures} from './array-views.mjs';
import {bindArrayWork,arrayWorkStructures} from './array-work.mjs';
import {bindIndexRelations,indexRelationStructures} from './index-relations.mjs';
import {bindLinkedStructures,linkedStructures} from './linked-views.mjs';
import {linkedRootCollections} from './linked-root-collections.mjs';
import {runtimeArrayViews} from './runtime-array-views.mjs';
import {indexedGraphStructures} from './indexed-graph-views.mjs';
import {recordIndexStructures} from './record-index-views.mjs';
import {arrayCursorPathStructures} from './array-cursor-paths.mjs';
import {valueIndexStructures} from './value-index-views.mjs';
import {parallelArrayStructures} from './parallel-array-views.mjs';
import {queueStructures} from './queue-views.mjs';
import {storageRelationStructures} from './storage-relations.mjs';
import {coindexedRecordStructures} from './coindexed-record-views.mjs';
import {indexDomainStructures} from './index-domain-views.mjs';
import {traversalGraphStructures} from './traversal-graph-views.mjs';
import {separateArrayStructures} from './separate-array-views.mjs';
import {createValueFlow} from './observed-value-flow.mjs';
import {topology} from '../shared/topology.mjs';
import {buildStructureStorageBindings} from './storage-bindings.mjs';
import {tableRowStructures} from './table-row-views.mjs';
import {composedContainerStructures} from './composed-container-views.mjs';
import {arrayMembershipStructures} from './array-membership.mjs';
import {arrayOccupancyStructures} from './array-occupancy.mjs';
import {annotateLinkedPolicies} from './linked-container-policy.mjs';
import {indexedRootStructures} from './indexed-root-views.mjs';
import {pointerTreeStructures} from './pointer-tree-views.mjs';
import {bstStructures} from './bst-views.mjs';
import {observedRecordRelations} from './observed-record-relations.mjs';
import {associativeStructures} from './associative-views.mjs';
import {sequenceLookupStructures} from './sequence-lookup-views.mjs';
import {partitionStructures} from './partition-views.mjs';
import {rangeAggregateStructures} from './range-aggregate-views.mjs';
import {pointerPartitionStructures,sharedRecordStructures} from './pointer-semantics.mjs';
import {compositePriorityStructures,pointerPriorityStructures} from './priority-comparison.mjs';
import {managementRoleStructures} from './management-roles.mjs';
import {deferredUpdateStructures,partitionSelectionStructures} from './composed-update-views.mjs';
import {boundStructureHistory} from './state-history.mjs';
import {createInferenceBudget,historyDiagnostics} from './inference-limits.mjs';
import {retainHistoryEvidence} from './history-evidence.mjs';

function readonly(value,seen=new WeakSet()){
  if(!value||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);for(const v of Object.values(value))readonly(v,seen);return Object.freeze(value);
}
export function inferStructures(plan,trace,{observationPlan,observedTrace,limits}={}){
  // Retention is an output policy, not a loss of the inputs to later passes.
  const inferenceBudget=createInferenceBudget(limits),buildOptions={};
  if(plan?.programId&&trace?.programId&&plan.programId!==trace.programId)throw new RangeError('계획과 실행 기록의 프로그램 식별자가 다릅니다.');
  for(const observed of [observationPlan,observedTrace])
    if(observed?.programId&&plan?.programId&&observed.programId!==plan.programId)throw new RangeError('다른 프로그램의 보조 관찰 기록은 사용할 수 없습니다.');
  if(observedTrace?.runId&&trace?.runId&&observedTrace.runId!==trace.runId)throw new RangeError('다른 실행의 보조 관찰 기록은 사용할 수 없습니다.');
  // Own a read-only snapshot: even freezing the caller's objects would change
  // their mutability contract. Neither success nor failure touches that input.
  ({plan,trace,observationPlan,observedTrace}=readonly(structuredClone({plan,trace,observationPlan,observedTrace})));
  const view={...plan,coverage:{...plan.coverage,structureInference:{...plan.coverage?.structureInference}},structureBindings:{}},diagnostics=[],groups=[],structures=[];
  const failed=(stage,error)=>diagnostics.push({code:error.code??'structure-inference-failed',stage,message:error.message??String(error),scope:'visualization-only'});
  for(const bind of [bindArrayStructures,bindArrayWork,bindIndexRelations,bindLinkedStructures]){
    try{if(bind===bindLinkedStructures)bind(view,trace);else bind(view);}catch(error){failed(bind.name,error);}
  }
  const context={...trace,structures,observationPlan,observedTrace,inferenceBudget,valueFlow:createValueFlow(view,{...trace,inferenceBudget})};
  function stage(name,build){inferenceBudget.setStage(name);try{const added=build();structures.push(...added);groups.push({name,structures:added});}catch(error){failed(name,error);}}
  stage('historical-records',()=>{
    const definitions=new Map(view.instructions.map(d=>[d.id,d])),events=new Map(trace.events.map(e=>[e.eventId,e])),
      internal=new Set(trace.objects.filter(o=>definitions.get(events.get(o.createdBy)?.instructionId)?.visibility==='implementation').map(o=>o.id)),
      visible=new Set(trace.views.filter(v=>!internal.has(v.objectId)).map(v=>v.id));
    return observedRecordRelations(observedTrace).map(s=>{
      const nodes=s.nodes.filter(id=>visible.has(id)),edges=s.edges.filter(e=>visible.has(e.from)&&visible.has(e.to));
      return {...s,kind:'record-graph-candidate',nodes,edges,...topology(nodes.map(id=>({id})),edges),
        temporalScope:'historical-union',classification:'storage-association-only',views:edges.length?['storage-reference-graph']:[],
        snapshot:'historical source references; not a current topology'};
    }).filter(s=>s.nodes.length);
  });
  stage('arrays',()=>arrayStructures(view,{...context,runtimeArrays:observationPlan&&observedTrace?
    runtimeArrayViews(view,observationPlan,observedTrace,trace):[]}));
  const arrays=structures.filter(s=>s.kind==='array');
  stage('separate-array-roles',()=>separateArrayStructures(view,context,buildOptions));
  stage('array-membership',()=>arrayMembershipStructures(view,context,buildOptions));
  stage('linked',()=>linkedStructures(view,{...context,arrays}).map(annotateLinkedPolicies));
  stage('root-collections',()=>linkedRootCollections(view,{...context,arrays,linked:structures.filter(s=>s.kind==='linked-structure')}));
  for(const build of [indexedGraphStructures,recordIndexStructures,arrayWorkStructures,arrayCursorPathStructures,
    valueIndexStructures,parallelArrayStructures,queueStructures,indexRelationStructures,storageRelationStructures,
    coindexedRecordStructures,indexDomainStructures,traversalGraphStructures,tableRowStructures,composedContainerStructures])stage(build.name,()=>build(view,context,buildOptions));
  stage('array-occupancy',()=>arrayOccupancyStructures(view,context,buildOptions));
  stage('indexed-roots',()=>indexedRootStructures(view,context,buildOptions).map(annotateLinkedPolicies));
  stage('pointer-tree-projections',()=>pointerTreeStructures(view,context,buildOptions));
  stage('ordered-tree-semantics',()=>bstStructures(view,context,buildOptions));
  stage('associative-lookups',()=>associativeStructures(view,context,buildOptions));
  stage('sequence-lookups',()=>sequenceLookupStructures(view,context,buildOptions));
  stage('representative-partitions',()=>partitionStructures(view,context,buildOptions));
  stage('range-aggregates',()=>rangeAggregateStructures(view,context,buildOptions));
  stage('pointer-partitions',()=>pointerPartitionStructures(view,context,buildOptions));
  stage('shared-records',()=>sharedRecordStructures(view,context,buildOptions));
  stage('composite-priority',()=>compositePriorityStructures(view,context,buildOptions));
  stage('pointer-priority',()=>pointerPriorityStructures(view,context,buildOptions));
  stage('management-roles',()=>managementRoleStructures(view,context,buildOptions));
  stage('deferred-updates',()=>deferredUpdateStructures(view,context,buildOptions));
  stage('partition-selection',()=>partitionSelectionStructures(view,context,buildOptions));
  // Fast path validates once. On rejection isolate the failing stage, including
  // dependent stages, without ever changing events, values, lifetimes or status.
  let accepted=structures;
  try{validateStructureTrace(view,{...trace,structures});}catch{
    accepted=[];
    for(const group of groups)try{validateStructureTrace(view,{...trace,structures:[...accepted,...group.structures]});accepted.push(...group.structures);}
    catch(error){failed(group.name,error);}
  }
  inferenceBudget.setStage('history-retention');
  accepted=retainHistoryEvidence(accepted,accepted.map(s=>boundStructureHistory(s,inferenceBudget.limits.maxStates)),trace,inferenceBudget);
  diagnostics.push(...inferenceBudget.diagnostics(),...historyDiagnostics(accepted));
  return {schemaVersion:1,scope:{programId:plan.programId??null,runId:trace.runId??null},status:diagnostics.length?'partial':'completed',structures:accepted,
    bindings:view.structureBindings,storageBindings:buildStructureStorageBindings(trace,accepted),coverage:view.coverage.structureInference??{},diagnostics};
}
