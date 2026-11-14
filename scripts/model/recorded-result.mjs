import {recordIR} from './ir-record.mjs';

// A rejected conversion is an engine failure, never a fault invented in the
// user's C program. Keep raw observations separate from playable public IR.
export function recordObservedTrace(plan,observationPlan,raw,{onExecution=()=>{}}={}){
  let trace;
  try{trace=recordIR(plan,observationPlan,raw);}
  catch(error){
    const instruction=plan.instructions.find(d=>d.id===error.context?.instructionId);
    const diagnostic={code:'engine-error',stage:'ir-recording',message:error.message,
      source:error.context?.source??instruction?.source??null,
      cause:{name:error.name,code:error.code??null,eventId:error.eventId??error.context?.eventId??null,context:error.context??null}};
    return {trace:{schemaVersion:3,programId:plan.programId,runId:raw.runId,backend:raw.backend,status:'engine-error',exitCode:raw.exitCode??null,
      events:[{schemaVersion:3,eventId:'x1',executionId:'x1',instructionId:plan.processInstructions['ERROR:fault'],activationId:null,
        kind:'ERROR',action:'fault',phase:'failed',evidence:'engine',observationIds:[],dataInputs:[],addressInputs:[],controlInputs:[],calleeInputs:[],inputs:[],diagnostic}],
      objects:[],frames:[],structures:[],views:[],references:[],flowTransitions:[],resultDeliveries:[],diagnostics:[diagnostic],
      coverage:{execution:raw.status,irConversion:'failed',observationEvents:raw.events.length,irEvents:1,irGaps:['ir-recording-failed']}},
      conversionFailure:{stage:'ir-recording',diagnostic,stack:error.stack??String(error),observedStatus:raw.status,observedExitCode:raw.exitCode??null}};
  }
  onExecution(trace);
  return {trace};
}
