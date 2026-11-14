import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {traceModel} from '../model/index.mjs';
import {inferStructures,createInferenceView,queryInferredSemantics} from '../inference/index.mjs';
const dir='test-results/inference-completion-audit-2026-11-12',id='local-comparator-lifetime';
const source=`#include <stdio.h>
typedef struct {int k,t;} E;
int before(const E*x,const E*y){if(x->k!=y->k)return x->k<y->k;return x->t>y->t;}
void work(void){E a[3]={{1,9},{2,7},{1,2}};int x=before(a,a+1),y=before(a,a+2);printf("%d %d\\n",x,y);}
int main(void){work();puts("end");return 0;}`;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const expected={sourceHash:hash(source),stdout:'1 1\nend\n',contract:'After work returns, its array lifetime has ended; historical comparator policy must not report that array alive.'};
try{if(JSON.stringify(JSON.parse(await fs.readFile(`${dir}/${id}.expected.json`)))!==JSON.stringify(expected))throw Error('Changed expectation');}
catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(`${dir}/${id}.expected.json`,JSON.stringify(expected,null,2),{flag:'wx'});}
await fs.writeFile(`${dir}/${id}.c`,source);
let raw;try{raw=JSON.parse(await fs.readFile(`${dir}/${id}.execution.json`));}catch(e){if(e.code!=='ENOENT')throw e;raw=await traceModel(source,{filename:`${id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${id}.execution.json`,JSON.stringify(raw));}
const unchanged=hash(JSON.stringify(raw)),i=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace}),{trace}=createInferenceView(raw,i);
if(unchanged!==hash(JSON.stringify(raw)))throw Error('IR mutated');
await fs.writeFile(`${dir}/${id}.inference.json`,JSON.stringify(i));
const result={execution:raw.trace.status,stdout:raw.stdout,stdoutMatches:raw.stdout===expected.stdout,inference:i.status,diagnostics:i.diagnostics,
 candidates:i.structures.filter(s=>s.kind==='composite-priority-candidate').map(s=>{const a=i.structures.find(a=>a.id===s.arrayId),o=trace.objects.find(o=>o.id===a.objectId),state=queryInferredSemantics(s,trace);return {id:s.id,arrayId:s.arrayId,objectId:o.id,actualEndedBy:o.endedBy,queryAlive:state.alive,queryStateAt:state.afterExecutionId,queryAt:trace.events.at(-1).eventId};})};
await fs.writeFile(`${dir}/${id}.results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
