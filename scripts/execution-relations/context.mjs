function requireRecord(condition,message){if(!condition)throw Object.assign(new Error(message),{code:'invalid-execution-records'});}
function index(rows,key,label){
  requireRecord(Array.isArray(rows),`${label} 목록이 필요합니다.`);
  const result=new Map();
  for(const row of rows){requireRecord(row&&typeof row[key]==='string'&&row[key]&&!result.has(row[key]),`${label} 식별자가 없거나 중복되었습니다.`);result.set(row[key],row);}
  return result;
}
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}
  return value;
}
export function executionScope(plan,trace){return {programId:typeof plan?.programId==='string'?plan.programId:null,runId:typeof trace?.runId==='string'?trace.runId:null};}

// Clone before freezing: caller-owned records must remain editable/unfrozen.
// Lookup maps stay private; passes receive frozen records and lookup functions.
export function createRelationContext(plan,trace,{structureInference}={}){
  requireRecord(plan?.schemaVersion===3&&trace?.schemaVersion===3,'스키마 3의 실행 계획·기록이 필요합니다.');
  requireRecord(typeof plan.programId==='string'&&plan.programId.length>0&&plan.programId===trace.programId,'실행 계획과 기록의 프로그램 식별자가 일치해야 합니다.');
  requireRecord(typeof trace.runId==='string'&&trace.runId.length>0,'실행 식별자가 필요합니다.');
  if(structureInference!==undefined)requireRecord(structureInference?.scope?.programId===plan.programId&&structureInference?.scope?.runId===trace.runId,'다른 실행의 자료구조 추론 결과를 사용할 수 없습니다.');
  const snapshot=freeze(structuredClone({plan,trace,structureInference}));
  const definitions=index(snapshot.plan.instructions,'id','명령 정의'),events=index(snapshot.trace.events,'eventId','사건'),
    objects=index(snapshot.trace.objects,'id','객체'),frames=index(snapshot.trace.frames,'id','호출 프레임');
  const positions=new Map(snapshot.trace.events.map((event,position)=>[event.eventId,position]));
  for(const event of events.values())requireRecord(definitions.has(event.instructionId),'정의에 연결되지 않은 실행 사건입니다.');
  return Object.freeze({...snapshot,scope:Object.freeze(executionScope(plan,trace)),
    event:id=>events.get(id),position:id=>positions.get(id),object:id=>objects.get(id),frame:id=>frames.get(id),instruction:id=>definitions.get(id)});
}
