import {encodeInference,decodeInference,createSharedValues} from '../../scripts/inference/shared-values.mjs';
// Only the transport changes. Every temporal presentation and its evidence is
// restored exactly; this is not a last-state-only summary.
export function encodePreparedStructures(data){
  if(data?.encoding==='prepared-shared-v1')return data;
  const encoded=encodeInference(Object.isFrozen(data)?data:createSharedValues().intern(data));
  return {...encoded,encoding:'prepared-shared-v1'};
}
export function decodePreparedStructures(data){
  return data?.encoding==='prepared-shared-v1'?decodeInference({...data,encoding:'inference-shared-v1'}):data;
}
