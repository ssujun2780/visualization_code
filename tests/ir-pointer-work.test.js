import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

async function inspect(source,filename='main.c'){
  const r=await traceModel(source,{filename,includeObservations:true});
  assert.equal(r.trace.status,'completed',JSON.stringify(r.trace.diagnostics));
  assert.deepEqual(r.trace.coverage.irGaps,[]);assert.deepEqual(r.trace.coverage.observationAccounting.unexplained,[]);
  assert.equal(r.plan.sourceMap.stats.semanticSourceScans,0);
  const defs=new Map(r.plan.instructions.map(d=>[d.id,d])),objects=new Map(r.trace.objects.map(o=>[o.name,o]));
  return {...r,defs,objects,at:line=>r.trace.events.filter(e=>defs.get(e.instructionId)?.source?.line===line)};
}
function distance(c,elements,bytes,size){
  assert.equal(c.kind,'CALC');assert.equal(c.operator,'-');assert.equal(c.value.decimal,String(elements));
  assert.equal(c.value.cType.signedness,'signed');assert.equal(c.steps.length,1);
  assert.equal(c.steps[0].value.decimal,String(elements));assert.deepEqual(c.distance,{
    operation:'pointer-difference',elementSizeBytes:size,defaultUnit:'elements',units:['elements','bytes'],
    byteDistance:String(bytes),elementDistance:String(elements)});
}

test('No10 records pointer increment, typed single-step distances and the one-past array identity',async()=>{
  const filename='examples/c/blind/No10.c',source=await readFile(new URL('../'+filename,import.meta.url),'utf8'),r=await inspect(source,filename);
  assert.equal(r.stdout,'10 10 10\n15 15 15\n15 22 15 22\n3 6 23 12\n2 1\n3 29 23 12\n1\n4 1\n');
  const inc=r.at(27);assert.deepEqual(inc.map(e=>e.kind),['READ','CALC','WRITE']);assert.equal(inc[1].operator,'++');
  assert.equal(r.defs.get(inc[1].instructionId).expression.position,'postfix');
  assert.equal(Number(inc[1].value.address)-Number(inc[0].value.address),4);assert.equal(inc[2].value.address,inc[1].value.address);
  assert.deepEqual(inc[2].dataInputs,[inc[1].eventId]);
  for(const [line,elements]of [[25,2],[30,1],[33,4]])distance(r.at(line).find(e=>e.kind==='CALC'&&e.operator==='-'),elements,elements*4,4);
  const arr=r.objects.get('gfMcgAsnQZ'),y=r.objects.get('MXkcXEpvuf');assert.equal(arr.size,16);assert.equal(y.size,4);
  const ref=r.trace.references.find(e=>e.objectId===y.id);assert.equal(ref.targetObjectId,arr.id);assert.equal(ref.targetOffset,16);
  assert.equal(ref.status,'one-past');assert.equal(ref.onePast,true);assert.equal(ref.dereferenceable,false);
  for(const e of r.at(33).filter(e=>e.kind==='READ')){assert.equal(e.value.reference.targetObjectId,arr.id);assert.equal(e.value.reference.onePast,true);}
  // Artifact output is opt-in for this review, never a second model invocation.
  if(process.env.POINTER_REVIEW_DIR){const dir=process.env.POINTER_REVIEW_DIR;await mkdir(dir,{recursive:true});
    for(const [f,data]of Object.entries({'plan.json':r.plan,'trace.json':r.trace,'observations.plan.json':r.observations.plan,'observations.trace.json':r.observations.trace}))await writeFile(`${dir}/${f}`,JSON.stringify(data,null,2));
    await writeFile(`${dir}/stdout.txt`,r.stdout);
  }
});

test('prefix/postfix pointer increments and decrements retain value routing and ABI strides',async()=>{
  const r=await inspect('int main(){double a[4]={1,2,3,4};double*p=a;\n double*old=p++;\n double*next=++p;\n double*before=p--;\n double*back=--p;\n return (int)(*old+*next+*before+*back);}');
  assert.equal(r.trace.exitCode,8);
  for(const [line,position,delta]of [[2,'postfix',8],[3,'prefix',8],[4,'postfix',-8],[5,'prefix',-8]]){
    const es=r.at(line),read=es.find(e=>e.kind==='READ'),calc=es.find(e=>e.kind==='CALC'),writes=es.filter(e=>e.action==='write');
    assert.ok(calc);assert.equal(r.defs.get(calc.instructionId).expression.position,position);
    assert.equal(Number(calc.value.address)-Number(read.value.address),delta);
    assert.deepEqual(writes[0].dataInputs,[calc.eventId]);assert.deepEqual(writes[1].dataInputs,[position==='postfix'?read.eventId:calc.eventId]);
  }
});

test('distance units handle byte elements, padded records, negatives and nested expressions',async()=>{
  const r=await inspect('struct Cell{char tag;int value;};\nint main(){char b[5]={0};struct Cell a[4];struct Cell*p=a+3,*q=a+1;\n long x=p-q;\n long y=q-p;\n long z=(p-q)+10;\n long c=&b[4]-b;\n return (int)(x+y+z+c);}');
  assert.equal(r.trace.exitCode,16);distance(r.at(3).find(e=>e.kind==='CALC'),2,16,8);
  distance(r.at(4).find(e=>e.kind==='CALC'),-2,-16,8);distance(r.at(6).find(e=>e.kind==='CALC'),4,4,1);
  const nested=r.at(5).find(e=>e.kind==='CALC');assert.equal(nested.value.decimal,'12');assert.equal(nested.distance,undefined);
  assert.equal(nested.steps.length,2);assert.deepEqual(nested.steps.map(s=>s.value.decimal),['2','12']);assert.equal(nested.steps[0].distance.byteDistance,'16');
});

test('one-past origin survives pointer copy, parameter passing, return and reread',async()=>{
  const r=await inspect('int*identity(int*p){return p;}\nint main(){int a[3]={0};int*p=a+3;int*q=p;int*r=identity(q);\n return (int)(r-a);}');
  assert.equal(r.trace.exitCode,3);assert.deepEqual(r.trace.coverage.gaps,[]);const arr=r.objects.get('a');
  for(const name of ['p','q','r']){const ref=r.trace.references.find(e=>e.objectId===r.objects.get(name).id);assert.equal(ref.targetObjectId,arr.id);assert.equal(ref.targetOffset,12);assert.equal(ref.status,'one-past');}
});

test('an adjacent address does not replace a known one-past origin, and dereferencing it faults',async()=>{
  // A focused recorder fixture fixes adjacency, which a C compiler may choose differently.
  const {ModelRecorder,TraceStopped}=await import('../scripts/model/recorder.mjs'),{layouts}=await import('../scripts/model/llvm.mjs');
  const r=new ModelRecorder({instructions:[]},layouts(''));r.setMemory(new WebAssembly.Memory({initial:1}));
  const a=r.create(1024,8,null,{type:'[2 x i32]'}),b=r.create(1032,4,null,{type:'i32'}),slot=r.create(1040,4,null,{type:'i32*'});
  const e=r.event('WRITE',null,{target:{objectId:slot.id,address:'0x00000410'},value:{address:'0x00000408'}});
  r.pointerWrite(slot,1040,'i32*',1032,e,a);const ref=r.references.get(`${slot.id}:0`);
  assert.equal(ref.targetObjectId,a.id);assert.notEqual(ref.targetObjectId,b.id);assert.equal(ref.targetOffset,8);assert.equal(ref.dereferenceable,false);
  assert.throws(()=>r.check(1032,4,{inputs:[]},{origin:a}),TraceStopped);assert.equal(r.diagnostics[0].code,'object-bounds');
});
