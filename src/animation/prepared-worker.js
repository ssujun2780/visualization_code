import {inferStructures} from '../../scripts/inference/structure-inference.mjs';
import {prepareStructures} from './prepared-structures.js';
import {encodePreparedStructures} from './prepared-format.js';
self.onmessage=({data})=>{
  try{
    const inference=data.inference??inferStructures(data.plan,data.trace);
    const prepared=prepareStructures(data.plan,data.trace,inference,{onProgress:progress=>self.postMessage({type:'progress',...progress})});
    self.postMessage({type:'ready',prepared:encodePreparedStructures(prepared),diagnostics:inference.diagnostics??[]});
  }catch(error){self.postMessage({type:'failure',message:error.message});}
};
