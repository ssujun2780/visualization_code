import {createV2Query} from '../../scripts/execution-relations/v2/query.mjs';
import {createWorkContextQuery} from './work-query-context.js';
let query;
self.onmessage=({data})=>{
  try{
    if(data.type==='load'){
      const {plan,trace,analysis:a}=data;
      const base=createV2Query(plan,trace,a.relations,{compilerFacts:a.compilerFacts,structureInference:a.structureInference});
      query=createWorkContextQuery(trace,base);
      self.postMessage({type:'ready',status:base.status});
    }else if(data.type==='query'&&query){
      self.postMessage({type:'context',id:data.id,...query.at(data.id)});
    }
  }catch(error){self.postMessage({type:'failure',message:error.message});}
};
