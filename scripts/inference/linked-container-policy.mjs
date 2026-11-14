// Endpoint policies describe observed edits to ordered identities, not helper
// names or payloads. Bulk replacement/reordering breaks the evidence episode.
const equal=(a,b)=>a.length===b.length&&a.every((id,i)=>id===b[i]);
export function annotateLinkedPolicies(s){
  const histories=new Map(),operations=[];
  for(const state of s.states){
    const assessments=[];
    for(const order of state.orders??[]){
      const role=order.fieldNodeId??order.roleId,ids=order.nodeIds;
      let h=histories.get(role);if(!h)histories.set(role,h={last:null,ops:[]});
      if(state.historyGap||!state.rootAlive||!['null','anchor','sentinel','boundary'].includes(order.termination)){
        h.last=null;h.ops=[];continue;
      }
      const previous=h.last;h.last=[...ids];
      if(previous&&!equal(previous,ids)){
        const insert=ids.length===previous.length+1,remove=previous.length===ids.length+1,
          large=insert?ids:previous,small=insert?previous:ids,
          front=(insert||remove)&&equal(large.slice(1),small),back=(insert||remove)&&equal(large.slice(0,-1),small);
        if(!front&&!back){h.ops=[];}
        else{
          const node=front?large[0]:large.at(-1),op={roleId:role,kind:insert?'insert':'remove',
            ends:[...front?['front']:[],...back?['back']:[]],nodeId:node,executionId:state.afterExecutionId};
          // An insertion is a newly present identity; neither payload equality
          // nor a detached node elsewhere can alter the order of this root.
          h.ops.push(op);operations.push(op);
        }
      }
      const inserts=h.ops.filter(o=>o.kind==='insert'),removes=h.ops.filter(o=>o.kind==='remove');
      if(!inserts.length||!removes.length)continue;
      // Permit either orientation. Single-element edits are ambiguous until a
      // later edit with two or more members distinguishes the endpoint.
      const fits=(ins,rem)=>h.ops.every(o=>o.ends.includes(o.kind==='insert'?ins:rem)),
        fifo=fits('back','front')||fits('front','back'),lifo=fits('front','front')||fits('back','back'),
        varied=h.ops.some(o=>o.ends.length===1&&o.ends[0]==='front')&&h.ops.some(o=>o.ends.length===1&&o.ends[0]==='back');
      const views=fifo&&!lifo?['queue']:lifo&&!fifo?['stack']:!fifo&&!lifo&&varied?['deque']:[];
      for(const view of views)assessments.push({view,roleIds:[role],status:'supported',scope:'observed-episode',
        supportingExecutionIds:h.ops.map(o=>o.executionId)});
    }
    state.endpointPolicies=assessments;
  }
  return {...s,endpointOperations:operations};
}
