// Validate projection identities and evidence, never the correctness of the
// user's links. Cycles, missing relations and reciprocal warnings remain data.
import {verificationStates} from './history-evidence.mjs';
export function validateLinkedProjections(trace){
  const events=new Map((trace.events??[]).map((e,index)=>[e.eventId,{event:e,index}])),
    objects=new Map((trace.objects??[]).map(o=>[o.id,o])),positions=new Map([...events].map(([id,e])=>[id,e.index]));
  const fail=message=>{throw new Error(`연결 투영: ${message}`);};
  const ids=(values,label)=>{
    if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||!id)||new Set(values).size!==values.length)fail(`${label} ID가 잘못됐습니다.`);
    return values;
  };
  const time=id=>{const e=events.get(id);if(!e)fail('실행 근거 ID가 없습니다.');return e.index;};
  const evidence=(values,before)=>{for(const id of ids(values,'근거'))if(time(id)>before)fail('미래 실행을 현재 상태의 근거로 사용했습니다.');};
  const same=(a,b)=>a.length===b.length&&a.every(id=>b.includes(id));
  const range=n=>{const o=objects.get(n?.objectId);if(!o||!Number.isSafeInteger(n.offset)||!Number.isSafeInteger(n.size)||n.offset<0||n.size<=0||n.offset+n.size>o.size)
    fail('논리 노드 또는 경계의 저장 범위가 잘못됐습니다.');};
  for(const structure of trace.structures??[]){
    if(structure.kind!=='linked-structure')continue;
    if(!structure.roleGroups&&!structure.warningEpisodes&&!(structure.states??[]).some(s=>s.roleTopologies||s.boundaries))continue;
    const nodes=new Map();
    for(const node of [...structure.logicalNodes??[],...structure.storageNodes??[]]){
      range(node);const previous=nodes.get(node.id);
      if(previous&&(previous.objectId!==node.objectId||previous.offset!==node.offset||previous.size!==node.size))fail('같은 노드 ID가 다른 저장소를 가리킵니다.');
      nodes.set(node.id,node);
    }
    const node=id=>{const n=nodes.get(id);if(!n)fail('투영의 논리 노드 ID가 없습니다.');return n;},groups=new Map(),episodes=new Map();
    for(const group of structure.roleGroups??[]){
      if(!group.id||groups.has(group.id)||group.recordTypeId!==structure.root.recordTypeId)fail('역할 그룹의 ID 또는 레코드가 잘못됐습니다.');
      ids(group.fieldNodeIds,'역할');ids(group.auxiliaryFieldNodeIds,'보조 역할');
      if(!group.fieldNodeIds.length||group.auxiliaryFieldNodeIds.some(id=>group.fieldNodeIds.includes(id)))fail('주 역할과 보조 역할이 겹칩니다.');
      groups.set(group.id,group);
    }
    for(const episode of structure.warningEpisodes??[]){
      if(!episode.id||episodes.has(episode.id))fail('경고 구간 ID가 중복됐습니다.');node(episode.from);node(episode.to);
      ids(episode.oppositeFieldNodeIds,'역관계 역할');
      const first=time(episode.firstExecutionId),last=time(episode.lastExecutionId),
        closed=episode.closedAtExecutionId===undefined?null:time(episode.closedAtExecutionId);
      if(first>last||closed!==null&&closed<=last)fail('경고 구간의 실행 순서가 잘못됐습니다.');
      if(!['active','transient-resolved','unresolved-at-end','out-of-scope'].includes(episode.status))fail('경고 구간 상태가 없습니다.');
      if(episode.status==='active'&&closed!==null||episode.status!=='active'&&closed===null)fail('경고 종료 시점과 상태가 다릅니다.');
      if(episode.status==='transient-resolved'){
        if(episode.resolvedAtExecutionId!==episode.closedAtExecutionId)fail('복구 근거가 경고 종료와 연결되지 않았습니다.');
      }else if(episode.resolvedAtExecutionId!==undefined)fail('미해소 경고에 복구 근거가 붙었습니다.');
      evidence(episode.evidenceExecutionIds??[],last);
      for(const id of ids(episode.observedAtBoundaryExecutionIds??[],'호출 경계')){
        const at=time(id),e=events.get(id).event;
        if(at<first||closed!==null&&at>=closed||e.kind!=='FLOW'||!['return','resume'].includes(e.action))fail('경고 관측 경계가 해당 실행 구간에 없습니다.');
      }
      episodes.set(episode.id,{episode,first,last});
    }
    // Cache only within this validation call and candidate. A later invocation
    // must re-check even the same object after external edits. Earlier evidence
    // remains valid at later times only for the same boundary/role context.
    const topologyChecks=new WeakMap();let previous=-1;
    for(const state of verificationStates(structure,positions)){
      const at=time(state.afterExecutionId);if(at<previous)fail('상태의 실행 순서가 뒤집혔습니다.');previous=at;
      const boundaries=new Map(),projections=new Map();
      for(const boundary of state.boundaries??[]){
        range(boundary);const n=node(boundary.nodeId);
        if(boundaries.has(boundary.nodeId)||n.objectId!==boundary.objectId||n.offset!==boundary.offset||n.size!==boundary.size||
          n.recordTypeId!==boundary.recordTypeId||boundary.recordTypeId!==structure.root.recordTypeId)fail('경계와 실제 하위 객체의 정체성이 다릅니다.');
        if(!(boundary.evidenceExecutionIds?.length))fail('종료 경계의 관측 근거가 없습니다.');
        evidence(boundary.evidenceExecutionIds,at);ids(boundary.sourceNodeIds??[],'경계 소스');boundaries.set(boundary.nodeId,boundary);
      }
      function topology(value,fields){
        if(!value)fail('역할 투영의 topology가 없습니다.');
        const context=JSON.stringify([fields,[...boundaries.keys()]]),checks=topologyChecks.get(value);
        if(checks?.get(context)<=at)return;
        if(value.rootNodeId!==null&&value.rootNodeId!==undefined)node(value.rootNodeId);
        for(const id of [...value.reachableNodeIds??[],...value.endedTargetNodeIds??[],...value.terminalNodeIds??[]])node(id);
        for(const id of value.terminalNodeIds??[])if(!boundaries.has(id))fail('종료 노드에 경계 근거가 없습니다.');
        for(const edge of value.edges??[]){
          const from=node(edge.from);if(edge.to)node(edge.to);
          if(fields&&!fields.includes(edge.fieldNodeId))fail('투영 간선이 다른 역할 그룹의 필드를 사용합니다.');
          if(edge.source){range(edge.source);if(edge.source.objectId!==from.objectId||edge.source.offset<from.offset||edge.source.offset+edge.source.size>from.offset+from.size)
            fail('간선 원본 범위가 해당 레코드 밖입니다.');}
          if(edge.lastWrite)evidence([edge.lastWrite],at);
          if(edge.termination==='sentinel'){
            const boundary=boundaries.get(edge.to);if(!boundary||edge.reference?.targetObjectId!==boundary.objectId||edge.reference?.targetOffset!==boundary.offset)
              fail('센티널 간선의 실제 대상과 종료 경계가 다릅니다.');
          }
        }
        for(const unknown of value.unknownRelations??[])if(fields&&unknown.fieldNodeId&&!fields.includes(unknown.fieldNodeId))fail('미관측 관계의 역할이 투영과 다릅니다.');
        if(!checks)topologyChecks.set(value,new Map([[context,at]]));else checks.set(context,at);
      }
      for(const projection of state.roleTopologies??[]){
        const group=groups.get(projection.roleGroupId);if(!group||projections.has(projection.roleGroupId))fail('상태의 역할 그룹 ID가 없거나 중복됐습니다.');
        ids(projection.fieldNodeIds,'투영 역할');ids(projection.auxiliaryFieldNodeIds,'투영 보조 역할');
        if(!same(projection.fieldNodeIds,group.fieldNodeIds)||projection.auxiliaryFieldNodeIds.some(id=>!group.auxiliaryFieldNodeIds.includes(id)))fail('상태의 역할과 선언된 역할 그룹이 다릅니다.');
        topology(projection.topology,projection.fieldNodeIds);projections.set(projection.roleGroupId,projection);
      }
      if(state.selectedRoleGroupId){
        const projection=projections.get(state.selectedRoleGroupId);
        if(!projection||projection.topology!==state.topology&&JSON.stringify(projection.topology)!==JSON.stringify(state.topology))fail('선택된 역할 투영과 표시 topology가 다릅니다.');
      }
      if(state.topology)topology(state.topology,null);
      for(const issue of state.inconsistencies??[]){
        if(!issue.episodeId)continue;
        const entry=episodes.get(issue.episodeId),episode=entry?.episode;
        if(!episode||at<entry.first||at>entry.last||issue.from!==episode.from||issue.to!==episode.to||issue.fieldNodeId!==episode.fieldNodeId||
          !same(issue.oppositeFieldNodeIds??[],episode.oppositeFieldNodeIds))fail('상태의 경고와 경고 구간이 일치하지 않습니다.');
        evidence(issue.evidenceExecutionIds??[],at);
        for(const target of issue.actualTargets??[]){if(!issue.oppositeFieldNodeIds.includes(target.fieldNodeId))fail('역관계 관측 대상의 역할이 다릅니다.');if(target.to)node(target.to);if(target.lastWrite)evidence([target.lastWrite],at);}
      }
    }
  }
  return trace;
}
