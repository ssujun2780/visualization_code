import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {boundaryCases} from './fixtures/structure-boundaries.mjs';
import {traceModel} from '../scripts/model/index.mjs';
import {inferStructures,createInferenceView,queryStructureRelations,queryStorageReferences,queryInferredSemantics,validateStructureTrace,recommendStructureViews,setStructurePresentation,resolveStructurePresentation} from '../scripts/inference/index.mjs';
const dir='test-results/structure-boundaries-2026-11-12',cache=new Map(),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const predictions=JSON.parse(await fs.readFile(new URL('./fixtures/structure-boundaries-expected.json',import.meta.url)));
await fs.mkdir(dir,{recursive:true});
await fs.mkdir('example/c/codex_code/structure_boundaries_20261112',{recursive:true});
async function load(id,source,stdout){
 if(cache.has(id))return cache.get(id);const fixture=boundaryCases.find(c=>c.id===id);source??=fixture.source;stdout??=fixture.stdout;let raw;
 const expected=fixture?predictions.find(c=>c.id===id):{sourceHash:hash(source),stdout};assert.equal(expected.sourceHash,hash(source));
 if(!fixture){try{assert.deepEqual(JSON.parse(await fs.readFile(`${dir}/${id}.expected.json`)),expected);}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(`${dir}/${id}.expected.json`,JSON.stringify(expected),{flag:'wx'});}}
 try{raw=JSON.parse(await fs.readFile(`${dir}/${id}.execution.json`));}catch(e){if(e.code!=='ENOENT')throw e;raw=await traceModel(source,{filename:`${id}.c`,includeObservations:true});await fs.writeFile(`${dir}/${id}.execution.json`,JSON.stringify(raw));await fs.writeFile(`example/c/codex_code/structure_boundaries_20261112/${id}.c`,source);}
 assert.equal(raw.trace.status,'completed',id);assert.equal(raw.stdout,stdout,id);const before=hash(JSON.stringify(raw)),inference=inferStructures(raw.plan,raw.trace,{observationPlan:raw.observations?.plan,observedTrace:raw.observations?.trace});
 assert.equal(inference.status,'completed',JSON.stringify(inference.diagnostics));assert.equal(hash(JSON.stringify(raw)),before,'read-only IR');await fs.writeFile(`${dir}/${id}.inference.json`,JSON.stringify(inference));const r={...createInferenceView(raw,inference),inference};validateStructureTrace(r.plan,r.trace);cache.set(id,r);return r;
}
const candidates=(r,kind)=>r.trace.structures.filter(s=>s.kind===kind),last=s=>s.states.at(-1),prints=r=>r.trace.events.filter(e=>e.action==='call'&&e.callee==='@printf'),object=(r,name)=>r.trace.objects.find(o=>o.name===name),
 source=id=>boundaryCases.find(c=>c.id===id).source;
function relations(r,name,event){return queryStructureRelations(r.trace,{target:{objectId:object(r,name).id},afterExecutionId:event.eventId}).relations;}
function order(relation,bytes){const byId=new Map(relation.nodes.map(n=>[n.id,n])),seen=new Set(),out=[];
 function visit(id){assert.ok(!seen.has(id),'unexpected cycle');seen.add(id);const n=byId.get(id);assert.ok(n,'missing member');out.push(n.range.offset/bytes);for(const e of relation.edges.filter(e=>e.from===id))visit(e.to);}
 relation.rootNodeIds.forEach(visit);assert.equal(seen.size,relation.nodes.length,'disconnected extra member');return out;
}
function grouped(s){const st=last(s);return st.groups.map(g=>g.members.map(id=>{const n=st.nodes.find(n=>n.id===id);return n.range.offset/n.range.size;}));}

test('all sixteen frozen predictions: normal execution, immutable input, valid actual evidence',async()=>{for(const c of boundaryCases)await load(c.id);});

test('mixed intrusive structures keep hash, forward, backward and tree/queue roles separate',async()=>{
 const r=await load('intrusive-hash-list'),[p,q]=prints(r),expected=boundaryCases[0].expect;
 for(const [at,want]of [[p,expected.orders[0]],[q,expected.orders[1]]]){const rs=relations(r,'head',at),list=rs.find(x=>x.nodes.length===3);assert.ok(list?.complete);assert.deepEqual(order(list,16),want);assert.equal(list.terminals.length,1);assert.equal(list.terminals[0].kind,'null');assert.ok(list.roleIds.length===1);}
 const s=candidates(r,'associative-lookup-candidate')[0];assert.ok(s);assert.ok(relations(r,'head',q).some(x=>x.roleIds[0]!==relations(r,'head',q).find(x=>x.nodes.length===3).roleIds[0]));
 const t=await load('tree-queue-shared-records'),rs=relations(t,'root',prints(t)[0]),tree=rs.find(x=>x.roleIds.length===2),queue=rs.find(x=>x.roleIds.length===1);assert.ok(tree?.complete&&queue?.complete);
 const edges=rel=>rel.edges.map(e=>[rel.nodes.find(n=>n.id===e.from).range.offset/16,rel.nodes.find(n=>n.id===e.to).range.offset/16]);assert.deepEqual(edges(tree),[[0,1],[0,2]]);assert.deepEqual(order(queue,16),[0,1,2]);assert.ok(!tree.roleIds.includes(queue.roleIds[0]));
});

test('rotation, split and a temporary cycle are shown at their actual checkpoints',async()=>{
 const r=await load('rotation-and-split'),wanted=boundaryCases.find(c=>c.id==='rotation-and-split').expect.rootOrders;
 for(const [i,p]of prints(r).entries()){const rel=relations(r,'root',p).find(x=>x.roleIds.length===2);assert.ok(rel?.complete);assert.deepEqual(order(rel,12),wanted[i]);assert.equal(rel.topology.cyclic,false);}
 const t=await load('temporary-cycle'),target={objectId:object(t,'head').id},prefs=setStructurePresentation(null,t.trace,{target,view:'tree'});
 assert.deepEqual(prints(t).map(e=>relations(t,'head',e)[0].topology.cyclic),[false,true,false]);
 for(const e of prints(t)){const selected=resolveStructurePresentation(t.trace,{target,preferences:prefs,afterExecutionId:e.eventId});assert.equal(selected.view,'tree');assert.equal(selected.source,'user');assert.ok(recommendStructureViews(t.trace,{target,afterExecutionId:e.eventId}).length<=5);}
});

test('free/reallocate and realloc exclude old storage; pool detach/reinsert preserves identities',async()=>{
 const r=await load('allocation-reuse'),rs=prints(r).map(e=>relations(r,'head',e).find(x=>x.alive&&x.nodes.length===2));assert.ok(rs.every(Boolean));assert.notEqual(rs[0].nodes[0].range.objectId,rs[1].nodes[0].range.objectId);
 const raw=candidates(r,'storage-reference-graph')[0],q=queryStorageReferences(raw,r.trace,{afterExecutionId:prints(r)[1].eventId});assert.ok(q.nodes.every(n=>n.range.objectId!==rs[0].nodes[0].range.objectId));
 const grow=await load('relocating-index-list');for(const [i,e]of prints(grow).entries()){const rel=relations(grow,'head',e).filter(x=>x.alive&&x.nodes.length);assert.equal(rel.length,1);assert.deepEqual(order(rel[0],8),i?[0,1,2,3]:[0,1]);}
 const pool=await load('pool-detach-reinsert'),all=prints(pool).map(e=>relations(pool,'head',e).find(x=>x.sourceKind==='linked-structure')),wants=[[0,1,2],[0,2],[1,0,2]];
 all.forEach((r,i)=>assert.deepEqual(order(r,8),wants[i]));assert.equal(all[0].nodes.find(n=>n.range.offset===8).id,all[2].nodes.find(n=>n.range.offset===8).id);
 const write=pool.trace.events.find(e=>e.action==='write'&&e.target?.objectId===object(pool,'a').id&&e.target.offset===8&&e.value?.decimal==='8');assert.ok(write);
});

test('current DSU membership loses stale merge support after a pool reset',async()=>{
 const r=await load('pool-partition-reset'),[s]=candidates(r,'pointer-partition-candidate');assert.ok(s.states.some(st=>st.status==='supported-observed'));assert.deepEqual(grouped(s),[[0],[1],[2]]);assert.equal(last(s).status,'representative-forest');assert.deepEqual(last(s).activeMergeExecutionIds,[]);
 assert.ok(!recommendStructureViews(r.trace,{target:{structureId:s.id}}).some(p=>p.view==='disjoint-set'));
 const code='#include <stdio.h>\nint p[3]; int f(int x){return p[x]==x?x:(p[x]=f(p[x]));} void join(int a,int b){a=f(a);b=f(b);if(a!=b)p[b]=a;} int main(void){for(int i=0;i<3;i++)p[i]=i;join(0,1);printf("%d ",f(1));for(int i=0;i<3;i++)p[i]=i;printf("%d ",f(1));return 0;}',t=await load('integer-partition-reset',code,'0 1 '),[a]=candidates(t,'representative-partition-candidate');assert.ok(a);assert.equal(last(a).status,'representative-forest');assert.deepEqual(last(a).groups.map(g=>g.members),[[0],[1],[2]]);assert.deepEqual(last(a).activeMergeExecutionIds,[]);
});

test('NULL and sentinel representatives preserve exact membership; a list endpoint is not a DSU',async()=>{
 for(const [id,mode]of [['null-parent-partition','null'],['sentinel-parent-partition','sentinel']]){const r=await load(id),[s]=candidates(r,'pointer-partition-candidate');assert.ok(s);assert.deepEqual(grouped(s),[[0,1,2],[3]]);assert.ok(s.terminals.every(t=>t.mode===mode));assert.equal(last(s).status,'supported-observed');assert.equal(s.operations.filter(p=>p.kind==='merge').length,2);if(mode==='sentinel')assert.ok(last(s).nodes.every(n=>n.range.objectId!==object(r,'end').id));}
 const r=await load('sentinel-list-negative');for(const s of candidates(r,'pointer-partition-candidate')){assert.equal(last(s).status,'representative-forest');assert.equal(s.operations.length,0);assert.ok(!recommendStructureViews(r.trace,{target:{structureId:s.id}}).some(p=>p.view==='disjoint-set'));}
});

test('terminal rules survive field reordering, renamed storage and an inverted branch',async()=>{
 const code=source('sentinel-parent-partition').replace('struct N*p;int x;','int x;struct N*p;').replace('if(p->p==&end)return p;return p->p=f(p->p);','if(p->p!=&end)return p->p=f(p->p);return p;').replaceAll(/\bend\b/g,'boundary').replaceAll(/\bjoin\b/g,'unite');
 const r=await load('sentinel-reordered',code,'0 0 0 3 '),[s]=candidates(r,'pointer-partition-candidate');assert.equal(s.fieldOffset,4);assert.deepEqual(grouped(s),[[0,1,2],[3]]);assert.ok(s.terminals.every(p=>p.mode==='sentinel'));assert.ok(last(s).nodes.every(n=>n.range.objectId!==object(r,'boundary').id));
});

test('pointer comparator policy is identified separately from an unproven heap shape',async()=>{
 const r=await load('pointer-comparator'),[s]=candidates(r,'composite-priority-candidate');assert.ok(s);assert.deepEqual(last(s).keyOrder.map(f=>[f.offset,f.direction]),[[0,1],[4,-1]]);assert.equal(last(s).min,'unknown');assert.equal(last(s).activeRange,null);assert.deepEqual(last(s).nodes,[]);
 const t=await load('pointer-comparator-reversed',source('pointer-comparator').replace('x->k<y->k','x->k>y->k').replace('x->t>y->t','x->t<y->t'),'4:1 3:7 2:5 2:9 ');assert.deepEqual(last(candidates(t,'composite-priority-candidate')[0]).keyOrder.map(f=>[f.offset,f.direction]),[[0,-1],[4,1]]);
});

test('bitwise aggregation retains exact coordinate coverage and current values',async()=>{
 const r=await load('or-range'),[s]=candidates(r,'range-aggregate-candidate');for(const [i,e]of prints(r).entries()){const node=queryInferredSemantics(s,r.trace,{afterExecutionId:e.eventId}).nodes.find(n=>n.index===1);assert.deepEqual([node.coverage.start,node.coverage.end],[0,4]);assert.equal(node.value.decimal,i?'11':'15');}
});

test('multiply and assignment lazy tags retain distinct operations, clearing and actual stale children',async()=>{
 for(const id of ['multiply-lazy','assign-lazy']){const r=await load(id),[s]=candidates(r,'deferred-update-candidate');assert.ok(s);assert.equal(s.applications.length,6);assert.deepEqual(s.propagations.map(p=>[p.index,p.childIndices]),[[1,[2,3]],[3,[6,7]]]);assert.equal(last(s).status,'observed-propagation');assert.ok(s.applications.every(p=>p.tagOperator===(id==='multiply-lazy'?'*':'assign')));assert.ok(s.propagations.every(p=>p.clearKind===(id==='multiply-lazy'?'neutral-tag':'presence-flag')));
  if(id==='multiply-lazy'){assert.ok(s.propagations.every(p=>p.neutralValue===1));assert.deepEqual(last(s).nodes.map(n=>[n.index,n.pending]),[[1,1],[2,6],[3,1],[6,6],[7,6]]);}
  else{assert.deepEqual(last(s).nodes.map(n=>[n.index,n.pending,n.present]),[[1,0,false],[2,0,true],[3,7,false],[6,7,true],[7,7,true]]);assert.ok(s.applications.every(p=>p.neutralValue===null));}
 }
 const r=await load('coupled-counters-negative'),[s]=candidates(r,'deferred-update-candidate');assert.ok(s);assert.equal(s.propagations.length,0);assert.equal(last(s).status,'coupled-update-candidate');
});

test('explicit multiply assignments and repeated pushes use new versions, not old propagation evidence',async()=>{
 const code=source('multiply-lazy').replace('v[k]*=d;tag[k]*=d;','v[k]=v[k]*d;tag[k]=tag[k]*d;').replace('push(1);push(3);','push(1);apply(1,2);push(1);push(3);');
 const r=await load('multiply-repeated-push',code,'60 6 48 '),[s]=candidates(r,'deferred-update-candidate');assert.equal(s.applications.length,9);assert.deepEqual(s.propagations.map(p=>p.index),[1,1,3]);assert.notEqual(s.propagations[0].sourceReadExecutionId,s.propagations[1].sourceReadExecutionId);assert.ok(!s.propagations[1].applicationExecutionIds.some(id=>s.propagations[0].applicationExecutionIds.includes(id)));
 const t=await load('multiply-fake-second-clear',source('multiply-lazy').replace('push(1);push(3);','push(1);apply(1,2);tag[1]=1;push(3);'),'60 6 24 '),[d]=candidates(t,'deferred-update-candidate');assert.deepEqual(d.propagations.map(p=>p.index),[1,3]);
});

test('validators reject altered memberships, neutral values and presence markers',async()=>{
 const r=await load('sentinel-parent-partition'),bad=structuredClone(r.trace),s=bad.structures.find(s=>s.kind==='pointer-partition-candidate');s.states.at(-1).groups[0].members.pop();assert.throws(()=>validateStructureTrace(r.plan,bad),/구성원/);
 const m=await load('multiply-lazy'),wrong=structuredClone(m.trace);wrong.structures.find(s=>s.kind==='deferred-update-candidate').propagations[0].neutralValue=0;assert.throws(()=>validateStructureTrace(m.plan,wrong),/지연/);
 const a=await load('assign-lazy'),flag=structuredClone(a.trace);flag.structures.find(s=>s.kind==='deferred-update-candidate').states.at(-1).nodes[1].present=false;assert.throws(()=>validateStructureTrace(a.plan,flag),/지연/);
 const omitted=structuredClone(a.trace),p=omitted.structures.find(s=>s.kind==='deferred-update-candidate').propagations[0];p.childIndices.pop();p.applicationExecutionIds.pop();assert.throws(()=>validateStructureTrace(a.plan,omitted),/완전성/);
 const altered=structuredClone(m.trace);altered.structures.find(s=>s.kind==='deferred-update-candidate').applications[0].tagOperator='+';assert.throws(()=>validateStructureTrace(m.plan,altered),/결합 연산/);
});
