// Connection identity, not values, types or example names, determines colour.
// Rewiring the same pointer slot therefore keeps its colour across playback.
const palette=['#7bcdf3','#b7a0ee','#7cd6bd','#e99bc7','#98b5ff','#b9d78d','#79d9df'];
export function pointerAppearance(id,focus,{scale=1,source}={}){
  let hash=2166136261;for(const character of String(id))hash=Math.imul(hash^character.charCodeAt(0),16777619)>>>0;
  const related=focus?.edges?.has(id)??false,dim=focus?.active&&!related,zoom=Math.max(.01,scale);
  // Existing hover/selection emphasis and unrelated-wire dimming stay intact.
  if(related||dim)return {color:related?'#9ed9ff':'#628da7',opacity:related?1:.12,
    width:Math.max(related?2.7:1.5,(related?1.8:.8)/zoom),head:5};
  // Colour-separated lanes are useful for array elements that each hold a
  // pointer. A pointer field inside an array of records is still an ordinary
  // pointer; only its immediate compiler-declared container decides this.
  const parent=source?.ancestors?.at(-1)?.cType;
  if(parent?.kind!=='array'||parent.elementType?.kind!=='pointer')
    return {color:'#628da7',opacity:.4,width:Math.max(1.2,.65/zoom),head:Math.max(4,3/zoom)};
  const width=Math.max(1.5,1.2/zoom);
  return {color:palette[hash%palette.length],opacity:.86,width,haloWidth:width+1.6/zoom,head:Math.max(5,5/zoom)};
}
