// Equivalent to JSON.stringify equality for the acyclic plain data emitted by
// the preparation adapter. Compare directly, without allocating large strings.
const omitted=v=>v===undefined||typeof v==='function'||typeof v==='symbol';
const scalar=v=>omitted(v)||typeof v==='number'&&!Number.isFinite(v)?null:v;
export function samePreparedValue(a,b){
  if(a===b)return true;
  a=scalar(a);b=scalar(b);if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const aa=Array.isArray(a),ba=Array.isArray(b);if(aa!==ba)return false;
  if(aa){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!samePreparedValue(a[i],b[i]))return false;return true;}
  const ak=Object.keys(a).filter(k=>!omitted(a[k])),bk=Object.keys(b).filter(k=>!omitted(b[k]));
  if(ak.length!==bk.length)return false;
  for(let i=0;i<ak.length;i++)if(ak[i]!==bk[i]||!samePreparedValue(a[ak[i]],b[bk[i]]))return false;
  return true;
}
