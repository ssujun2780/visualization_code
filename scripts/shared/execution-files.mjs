import {readFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createExecutionEncoder,createExecutionDecoder,EXECUTION_ENCODING,isExecutionEncoding} from './execution-format.mjs';
import {writeJSON,writeJSONLines} from './json-output.mjs';
const read=async(file,optional=false)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(optional&&e.code==='ENOENT')return undefined;throw e;}};
export async function writeExecutionFiles(directory,result,{expanded=false,pretty=false,jsonl=false}={}){
 await mkdir(directory,{recursive:true});
 const encoder=expanded?null:createExecutionEncoder(),pack=v=>encoder?encoder.pack(v??null):v??null,
  files={'plan.json':pack(result.plan),'trace.json':pack(result.trace)};
 const remove=async name=>{try{await unlink(join(directory,name));}catch(e){if(e.code!=='ENOENT')throw e;}};
 // Remove only known optional artifacts, never unrelated user files. A previous
 // run's observations/JSONL must not be mistaken for this run's record.
 for(const [name,value]of Object.entries({'observations.plan.json':result.observations?.plan,'observations.trace.json':result.observations?.trace})){
  if(value!=null)files[name]=pack(value);else await remove(name);
 }
 const lineEvents=jsonl?(result.trace?.events??[]).map(e=>encoder?encoder.pack(e).data:e):null;
 await writeJSON(join(directory,'definitions.json'),encoder?.definitions??null,{pretty});
 for(const [name,value]of Object.entries(files))await writeJSON(join(directory,name),value,{pretty});
 if(jsonl)await writeJSONLines(join(directory,'trace.jsonl'),lineEvents);
 else await remove('trace.jsonl');
 return {encoding:encoder?EXECUTION_ENCODING:'expanded',definitions:encoder?.definitions};
}
export async function readExecutionFiles(directory,{includeObservations=true}={}){
 const [definitions,plan,trace,observationPlan,observedTrace]=await Promise.all([
  read(join(directory,'definitions.json'),true),read(join(directory,'plan.json')),read(join(directory,'trace.json')),
  includeObservations?read(join(directory,'observations.plan.json'),true):undefined,includeObservations?read(join(directory,'observations.trace.json'),true):undefined]);
 const packed=[plan,trace,observationPlan,observedTrace].some(v=>isExecutionEncoding(v?.encoding)),decode=packed?createExecutionDecoder(definitions):v=>v;
 const a=decode(observationPlan),b=decode(observedTrace);
 return {plan:decode(plan),trace:decode(trace),observations:a!=null||b!=null?{plan:a,trace:b}:undefined};
}
