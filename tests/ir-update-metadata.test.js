import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {traceModel} from '../scripts/model/index.mjs';

function inspect(result){
  const defs=new Map(result.plan.instructions.map(i=>[i.id,i])),objects=new Map(result.trace.objects.map(o=>[o.id,o]));
  return {...result,defs,line:e=>defs.get(e.instructionId)?.source?.line,name:e=>objects.get(e.target?.objectId)?.name};
}

test('No6 access types and source operators preserve prefix/postfix routing and one target evaluation',async()=>{
  const source=await readFile(new URL('../examples/c/blind/No6.c',import.meta.url),'utf8');
  const {trace,stdout,defs,line,observations}=inspect(await traceModel(source,{includeObservations:true}));
  assert.equal(trace.status,'completed');assert.equal(stdout,'6 5\n7 7\n8 12\n9 63\n1\n1 15 20 30\n');
  assert.equal(trace.events.length,86);assert.equal(trace.events.filter(e=>e.kind==='CALC').length,11);
  for(const [l,position,oldValue,newValue]of [[5,'postfix','5','6'],[8,'prefix','6','7'],[11,'postfix','7','8'],[14,'prefix','8','9'],[25,'postfix','0','1']]){
    const events=trace.events.filter(e=>line(e)===l),reads=events.filter(e=>e.kind==='READ');
    const read=reads[0],calc=events.find(e=>e.kind==='CALC'&&e.operator==='++'),write=events.find(e=>e.action==='write');
    assert.equal(read.value.decimal,oldValue);assert.equal(calc.value.decimal,newValue);assert.equal(write.value.decimal,newValue);
    assert.equal(defs.get(calc.instructionId).expression.position,position);
    assert.ok(events.indexOf(read)<events.indexOf(calc)&&events.indexOf(calc)<events.indexOf(write));
    assert.deepEqual(write.dataInputs,[calc.eventId]);
    const consumer=l===25?reads[1]:[11,14].includes(l)?events.find(e=>e.kind==='CALC'&&e.operator!=='++'):events.filter(e=>e.action==='write').at(-1);
    const inputs=l===25?consumer.addressInputs:consumer.dataInputs;
    assert.ok(inputs.includes(position==='postfix'?read.eventId:calc.eventId));
    assert.ok(!inputs.includes(position==='postfix'?calc.eventId:read.eventId));
  }
  const arrayWork=trace.events.filter(e=>line(e)===25&&['READ','WRITE'].includes(e.kind));
  assert.equal(arrayWork.length,4,'one index read/write and one array element read/write');
  for(const e of arrayWork){assert.equal(e.value.cType.name,'int');assert.equal(defs.get(e.instructionId).cType.name,'int');}
  assert.deepEqual(arrayWork.map(e=>e.value.decimal),['0','1','10','15']);
  assert.deepEqual(arrayWork.slice(2).map(e=>e.target.offset),[0,0]);
  for(const e of trace.events.filter(e=>e.kind==='CALC'))assert.equal(e.operator,defs.get(e.instructionId).operator);
  assert.deepEqual(trace.events.filter(e=>e.kind==='CALC'&&[11,14,25].includes(line(e))&&e.operator!=='++').map(e=>e.operator),['+=','*=','+=']);
  assert.ok(observations.trace.events.some(e=>e.kind==='CALC'&&e.operator==='mul'));
  assert.ok(observations.trace.events.some(e=>e.kind==='CALC'&&e.operator==='add'));
});

test('compound access uses unsigned storage type for array members and pointers without changing index reads',async()=>{
  const source=`typedef struct {unsigned char value;} Cell;
int main(){Cell cells[2]={{250},{7}};int i=0;
 cells[i++].value += 10;
 unsigned char *p=&cells[1].value;
 *p += 250;
 unsigned int a[1]={0};
 a[0] -= 1;
 return i+cells[0].value+cells[1].value+(a[0]==4294967295U);}`;
  const {trace,defs,line,name}=inspect(await traceModel(source));assert.equal(trace.status,'completed');assert.equal(trace.exitCode,7);
  for(const [l,before,after]of [[3,'250','4'],[5,'7','1']]){
    const access=trace.events.filter(e=>line(e)===l&&name(e)==='cells'&&['READ','WRITE'].includes(e.kind));
    assert.equal(access.length,2);assert.deepEqual(access.map(e=>e.value.decimal),[before,after]);
    for(const e of access){assert.equal(e.value.cType.name,'unsigned char');assert.equal(e.value.cType.sizeBits,8);assert.deepEqual(e.value.cType.display.badges,['u']);assert.equal(defs.get(e.instructionId).cType.name,'unsigned char');}
    const definitions=[...defs.values()].filter(d=>d.kind==='CALC'&&d.source?.line===l&&d.operator==='+='&&d.calculationType);
    assert.ok(definitions.length);assert.ok(definitions.every(d=>d.calculationType.name==='int'&&d.storageType.name==='unsigned char'));
    const values=trace.events.filter(e=>e.kind==='CALC'&&line(e)===l).flatMap(e=>e.steps?.map(s=>s.value)??[e.value]);
    assert.ok(values.some(v=>v.cType?.name==='int'&&v.decimal===(l===3?'260':'257')));
  }
  const indices=trace.events.filter(e=>line(e)===3&&name(e)==='i');
  assert.deepEqual(indices.map(e=>[e.kind,e.value.cType.name,e.value.decimal]),[['READ','int','0'],['WRITE','int','1']]);
  const unsigned=trace.events.filter(e=>line(e)===7&&name(e)==='a');
  assert.deepEqual(unsigned.map(e=>[e.kind,e.value.cType.name,e.value.decimal]),[['READ','unsigned int','0'],['WRITE','unsigned int','4294967295']]);
});

test('float element access retains storage width while compound arithmetic uses double',async()=>{
  const {trace,defs,line}=inspect(await traceModel('int main(){float a[1]={1.5f};\n a[0]+=2.0;\n return (int)a[0];}'));
  assert.equal(trace.status,'completed');assert.equal(trace.exitCode,3);
  const access=trace.events.filter(e=>line(e)===2&&['READ','WRITE'].includes(e.kind));
  assert.deepEqual(access.map(e=>[e.value.cType.name,e.value.number]),[['float','1.5'],['float','3.5']]);
  const calc=trace.events.find(e=>line(e)===2&&e.kind==='CALC');
  assert.equal(calc.operator,'+=');assert.equal(defs.get(calc.instructionId).calculationType.name,'double');
  assert.equal(defs.get(calc.instructionId).storageType.name,'float');
  assert.ok(calc.steps.some(s=>s.value.cType.name==='double'&&s.value.number==='3.5'));
});
