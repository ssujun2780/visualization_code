import {recordObservedTrace} from './recorded-result.mjs';

export function partialResult(prepared,raw,{includeObservations=false,skipConversion=false,retainedRaw=raw}={}){
  const {observationPlan,type,...info}=prepared;
  const diagnostic=raw.diagnostics.at(-1),event=raw.events.at(-1);
  // Bounded recovery is exclusively for execution records; optional inference
  // must not spend that budget and discard an otherwise recovered IR prefix.
  const recorded=prepared.plan&&!skipConversion?recordObservedTrace(prepared.plan,observationPlan,raw):{
    trace:{...raw,schemaVersion:3,events:[{...event,schemaVersion:3,eventId:'x1',executionId:'x1',instructionId:prepared.plan?.processInstructions?.['ERROR:fault']??null,
      action:'fault',phase:'failed'}],diagnostics:[{...diagnostic,eventId:'x1'}],objects:[],frames:[],views:[],references:[]},
    ...(skipConversion?{conversionFailure:{stage:'ir-finalization',diagnostic,observedStatus:raw.status,reason:'bounded partial conversion deadline'}}:{})};
  const delivered=channel=>Buffer.concat(retainedRaw.events.filter(e=>e.action==='output.delivery'&&e.channel===channel)
    .map(e=>Buffer.from(e.bytesHex,'hex'))).toString('utf8');
  return {...info,stdout:delivered('stdout'),stderr:delivered('stderr'),compilerDiagnostics:'',...recorded,
    ...(retainedRaw!==raw?{conversionNotice:{stage:'ir-finalization',code:'partial-ir-prefix',
      convertedObservations:raw.events.length-1,retainedObservations:retainedRaw.events.length-1}}:{}),
    ...(includeObservations||recorded.conversionFailure||retainedRaw!==raw?{observations:{plan:observationPlan??null,trace:retainedRaw}}:{})};
}
