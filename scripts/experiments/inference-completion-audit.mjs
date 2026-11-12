// Inspection probes only. Expected facts are fixed before executing C.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {traceModel} from '../model/index.mjs';
import {inferStructures,createInferenceView,queryInferredSemantics,queryStructureConditions,setStructurePresentation,resolveStructurePresentation,querySequenceLookup,recommendStructureViews} from '../inference/index.mjs';
import {sequenceLookupStructures} from '../inference/sequence-lookup-views.mjs';
const dir='test-results/inference-completion-audit-2026-11-12',hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const pre='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n';
const cases=[
 {id:'pointer-policy-lifetime',stdout:'1 1\nend\n',expected:'Comparator policy may remain historical, but query after free must not say the allocation is alive.',source:pre+String.raw`
typedef struct{int k,t;}E;E*a;
int before(const E*x,const E*y){if(x->k!=y->k)return x->k<y->k;return x->t>y->t;}
int main(void){a=malloc(3*sizeof *a);if(!a)return 1;a[0]=(E){1,9};a[1]=(E){2,7};a[2]=(E){1,2};int x=before(a,a+1),y=before(a,a+2);printf("%d %d\n",x,y);free(a);a=0;puts("end");return 0;}`},
 {id:'constant-leaf-range',stdout:'15\n',expected:'A built binary range hierarchy exists without an independent input array; expected shape is a segment tree, not a claim about source-array identity.',source:pre+String.raw`
int v[8];int main(void){v[4]=1;v[5]=2;v[6]=4;v[7]=8;for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];printf("%d\n",v[1]);return 0;}`},
 {id:'or-lazy',stdout:'63 48 56\n',expected:'OR pending tags combine to 48; propagation from 1 to 2,3 and from 3 to 6,7; clearing uses zero.',source:pre+String.raw`
int a[4]={1,2,4,8},v[8],tag[8];void apply(int k,int d){v[k]|=d;tag[k]|=d;}void push(int k){if(tag[k]){int d=tag[k];apply(k*2,d);apply(k*2+1,d);tag[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]|v[2*i+1];apply(1,16);apply(1,32);int sum=v[1],t=tag[1];push(1);push(3);printf("%d %d %d\n",sum,t,v[7]);return 0;}`},
 {id:'xor-even-range',stdout:'15 16 24\n',expected:'A pending XOR tag is real even when an even-length XOR aggregate is unchanged; pushes 1 and 3 forward it to both children.',source:pre+String.raw`
int a[4]={1,2,4,8},v[8],tag[8];void apply(int k,int n,int d){if(n%2)v[k]^=d;tag[k]^=d;}void push(int k,int n){if(tag[k]){int d=tag[k];apply(k*2,n/2,d);apply(k*2+1,n/2,d);tag[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]^v[2*i+1];apply(1,4,16);int sum=v[1],t=tag[1];push(1,4);push(3,2);printf("%d %d %d\n",sum,t,v[7]);return 0;}`},
 {id:'full-flag-ring',stdout:'1 2 3 4 5\n',expected:'A capacity-three FIFO that distinguishes equal cursors using full; full is not empty.',source:pre+String.raw`
int a[3],h,t,full;void put(int x){if(full)return;a[t]=x;t=(t+1)%3;full=t==h;}int pop(void){if(h==t&&!full)return -1;int x=a[h];h=(h+1)%3;full=0;return x;}
int main(void){put(1);put(2);put(3);int x=pop(),y=pop();put(4);put(5);int z=pop(),u=pop(),v=pop();printf("%d %d %d %d %d\n",x,y,z,u,v);return 0;}`},
 {id:'string-key-hash',stdout:'9 7\n',expected:'Bucket lookup using key-derived hash and strcmp equality is a hash-table relationship.',source:pre+String.raw`
typedef struct N{const char*k;int v;struct N*next;}N;N nodes[2];N*b[3];
unsigned h(const char*s){unsigned x=0;while(*s)x=x*31+(unsigned char)*s++;return x%3;}
void put(int i,const char*k,int v){nodes[i].k=k;nodes[i].v=v;unsigned x=h(k);nodes[i].next=b[x];b[x]=nodes+i;}
int get(const char*k){for(N*p=b[h(k)];p;p=p->next)if(strcmp(k,p->k)==0)return p->v;return -1;}
int main(void){put(0,"ab",9);put(1,"bc",7);int x=get("ab"),y=get("bc");printf("%d %d\n",x,y);return 0;}`},
 {id:'trie-history',stdout:'1 0 1\n',expected:'At checkpoints the observed word is accepted, then not accepted, then accepted. A history budget may omit the middle state, but must signal that gap.',source:pre+String.raw`
typedef struct N{struct N*c[2];int end;}N;N a[3];
int has(const char*s){N*p=a;while(*s){int k=*s-'0';if(!p->c[k])return 0;p=p->c[k];s++;}return p->end;}
int main(void){a[0].c[0]=a+1;a[1].c[1]=a+2;a[2].end=1;int x=has("01");a[2].end=0;int y=has("01");a[2].end=1;int z=has("01");printf("%d %d %d\n",x,y,z);return 0;}`}
];
await fs.mkdir(dir,{recursive:true});
const fixed=cases.map(c=>({id:c.id,sourceHash:hash(c.source),stdout:c.stdout,expected:c.expected}));
try{const old=JSON.parse(await fs.readFile(`${dir}/probe-expectations.json`));if(JSON.stringify(old)!==JSON.stringify(fixed))throw Error('Frozen probe expectations changed');}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(`${dir}/probe-expectations.json`,JSON.stringify(fixed,null,2),{flag:'wx'});}
const summaries=[];
for(const c of cases){await fs.writeFile(`${dir}/${c.id}.c`,c.source);let raw;try{raw=JSON.parse(await fs.readFile(`${dir}/${c.id}.execution.json`));}catch(e){if(e.code!=='ENOENT')throw e;raw=await traceModel(c.source,{filename:`${c.id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${c.id}.execution.json`,JSON.stringify(raw));}
 const row={id:c.id,execution:raw.trace?.status,stdout:raw.stdout,stdoutMatches:raw.stdout===c.stdout,expected:c.expected};
 if(raw.trace?.status==='completed'&&row.stdoutMatches){const before=hash(JSON.stringify(raw)),i=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});if(hash(JSON.stringify(raw))!==before)throw Error('IR mutated');
  await fs.writeFile(`${dir}/${c.id}.inference.json`,JSON.stringify(i));const {plan,trace}=createInferenceView(raw,i);row.inference=i.status;row.diagnostics=i.diagnostics;row.candidates=i.structures.map(s=>({id:s.id,kind:s.kind}));
  const kind=k=>i.structures.filter(s=>s.kind===k);
  if(c.id==='pointer-policy-lifetime')row.afterFree=kind('composite-priority-candidate').map(s=>({state:queryInferredSemantics(s,trace),actualEndedBy:trace.objects.find(o=>o.id===trace.structures.find(a=>a.id===s.arrayId).objectId)?.endedBy}));
  if(c.id==='constant-leaf-range')row.rangeCandidates=kind('range-aggregate-candidate').length;
  if(c.id.endsWith('lazy')||c.id==='xor-even-range')row.deferred=kind('deferred-update-candidate').map(s=>({applications:s.applications.length,propagations:s.propagations.map(p=>[p.index,p.childIndices]),status:s.states.at(-1).status}));
  if(c.id==='full-flag-ring'){const o=trace.objects.find(o=>o.name==='a');row.recommendations=recommendStructureViews(trace,{target:{objectId:o.id}}).map(r=>r.view);row.containerPolicies=i.structures.filter(s=>['array-structure','counted-queue-candidate'].includes(s.kind)).map(s=>({kind:s.kind,status:s.states?.at(-1)?.status,selectedRole:s.states?.at(-1)?.selectedRole}));}
  if(c.id==='string-key-hash')row.associativeCount=kind('associative-lookup-candidate').length;
  if(c.id==='trie-history'){const full=kind('sequence-lookup-candidate'),limited=sequenceLookupStructures(plan,trace,{maxStates:2});row.historyProbes=[];
   for(const s of limited){const original=full.find(x=>x.id===s.id);if(!original||original.states.length<4)continue;const first=s.states[0],last=s.states.at(-1),pos=new Map(trace.events.map((e,n)=>[e.eventId,n]));
    const middle=original.states.find(st=>pos.get(st.afterExecutionId)>pos.get(first.afterExecutionId)&&pos.get(st.afterExecutionId)<pos.get(last.afterExecutionId));if(!middle)continue;
    const t={...trace,structures:trace.structures.map(x=>x.id===s.id?s:x)},actual=querySequenceLookup(t,{candidateId:s.id,afterExecutionId:middle.afterExecutionId});
    row.historyProbes.push({candidate:s.id,requested:middle.afterExecutionId,returned:actual.state.afterExecutionId,gapSignalled:!!actual.state.historyGap,coverage:s.coverage,fullStateCount:original.states.length});
   }
  }
 }
 summaries.push(row);console.log(JSON.stringify({...row,candidates:row.candidates?.map(s=>s.kind),afterFree:row.afterFree?.map(x=>({alive:x.state?.alive,afterExecutionId:x.state?.afterExecutionId,actualEndedBy:x.actualEndedBy})),historyProbes:row.historyProbes?.slice(0,2)}));
}
// Query-contract probes use saved executions; no compiler or inference source is changed.
const contracts=[];
for(const [dirName,id,kind,view]of [['structure-extensions-2026-11-12','composite-heap','composite-priority-candidate','min-heap'],['structure-boundaries-2026-11-12','multiply-lazy','range-aggregate-candidate','segment-tree'],['structure-boundaries-2026-11-12','null-parent-partition','pointer-partition-candidate','disjoint-set']]){
 const raw=JSON.parse(await fs.readFile(`test-results/${dirName}/${id}.execution.json`)),i=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace}),{trace}=createInferenceView(raw,i),s=i.structures.find(s=>s.kind===kind),target={structureId:s.id},prefs=setStructurePresentation(null,trace,{target,view});
 const manual=resolveStructurePresentation(trace,{target,preferences:prefs}),explicit=queryStructureConditions(trace,{target,expected:view});contracts.push({id,view,manualExpected:manual.expected,hasExpectationCheck:!!manual.expectationCheck,explicitAssessment:explicit.assessment,explicitReason:explicit.reason});
}
await fs.writeFile(`${dir}/probe-results.json`,JSON.stringify({cases:summaries,contracts},null,2));console.log(JSON.stringify({contracts}));
