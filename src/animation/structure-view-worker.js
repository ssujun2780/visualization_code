import {inferStructures} from '../../scripts/inference/structure-inference.mjs';
import {createStructureViewQuery} from './structure-query.js';
let query;
self.onmessage=({data})=>{
  try{
    if(data.type==='load'){
      const {plan,trace}=data,inference=data.inference??inferStructures(plan,trace);
      query=createStructureViewQuery(plan,trace,inference);
      for(const setting of data.choices??[])query.set(setting.target,setting.choice,setting.at);
      self.postMessage({type:'ready',status:inference.status,count:inference.structures?.length??0,diagnostics:inference.diagnostics??[],fallback:!data.inference});
    }else if(data.type==='query'&&query){
      self.postMessage({type:'views',key:data.key,views:data.targets.map(target=>{
        try{return query.project(target,data.at,{focus:data.focus,limit:data.limit});}
        catch(error){return {target,view:'boxes',warnings:[error.message],recommendations:[],mode:'auto',queryFailed:true};}
      })});
    }else if(data.type==='choose'&&query){query.set(data.target,data.choice,data.at);self.postMessage({type:'chosen'});}
  }catch(error){self.postMessage({type:'failure',message:error.message});}
};
