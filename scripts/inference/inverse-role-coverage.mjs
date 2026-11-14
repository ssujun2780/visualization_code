// A root-preserving tree projection may treat a proven inverse role as an
// auxiliary connection. Unknown, missing and unrelated edges do not qualify.
export function inverseRoleCoverage(state,selectedRoles,excludedRoles,members){
  if(!selectedRoles?.length||!excludedRoles?.length||!members?.length)return null;
  const canon=id=>id?.replace(/^field:/,''),selected=new Set(selectedRoles.map(canon)),excluded=new Set(excludedRoles.map(canon)),
    ids=new Set(members),edges=state?.edges??[],children=edges.filter(e=>selected.has(canon(e.fieldNodeId??e.roleId))&&e.to&&ids.has(e.from)&&ids.has(e.to)),
    auxiliary=edges.filter(e=>excluded.has(canon(e.fieldNodeId??e.roleId))&&ids.has(e.from));
  if(!children.length||!auxiliary.length)return null;
  const inverses=auxiliary.filter(e=>e.to);
  if(inverses.length!==children.length||!inverses.every(e=>children.some(c=>c.from===e.to&&c.to===e.from))||
    !children.every(c=>inverses.filter(e=>e.to===c.from&&e.from===c.to).length===1)||
    auxiliary.some(e=>!e.to&&!['null','observed-termination'].includes(e.status))||
    ![...excluded].every(role=>auxiliary.some(e=>canon(e.fieldNodeId??e.roleId)===role)))return null;
  const evidence=[...new Set([...children,...auxiliary].map(e=>e.lastWrite??e.lastWriteExecutionId??e.executionId).filter(Boolean))];
  return evidence.length?{roleIds:[...excludedRoles],evidenceExecutionIds:evidence,kind:'observed-inverse-links'}:null;
}
