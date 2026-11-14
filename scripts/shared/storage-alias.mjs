// Compiler-proven shared storage. Addresses alone never establish identity.
export function storageRoot(get,id){
  let object=get(id),offset=0;const seen=new Set(),declaredRoots=[];
  if(!object)return null;
  while(object.storageAlias){
    if(seen.has(object.id))return null;seen.add(object.id);
    const a=object.storageAlias,parent=get(a.objectId);
    if(!parent||!Number.isSafeInteger(a.offset)||a.offset<0||a.offset+object.size>parent.size)return null;
    if(a.rootObjectId)declaredRoots.push(a.rootObjectId);
    offset+=a.offset;object=parent;
  }
  if(declaredRoots.some(id=>id!==object.id))return null;
  return {object,offset};
}
