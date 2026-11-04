import {topology} from "../../model/structure.mjs";
export {topology};

export function inferDynamicArray(samples) {
  if(!samples.length) return null;
  const numeric=samples[0].before.filter(f=>f.kind==="size").map(f=>f.id);
  const get=(fields,id)=>fields.find(f=>f.id===id)?.value;
  const lengths=numeric.filter(id=>samples.every(s=>get(s.after,id)===get(s.before,id)+1&&s.store.offset===get(s.before,id)*s.store.width));
  const strides=numeric.filter(id=>samples.every(s=>get(s.before,id)===get(s.after,id)&&get(s.after,id)===s.store.width));
  const capacities=numeric.filter(id=>!lengths.includes(id)&&!strides.includes(id)&&samples.every(s=>
    lengths.some(l=>get(s.after,id)>=get(s.after,l))&&get(s.after,id)*s.store.width===s.payloadBytes));
  if(lengths.length!==1||strides.length!==1||capacities.length!==1) return null;
  return {view:"dynamic-array",lengthField:lengths[0],strideField:strides[0],capacityField:capacities[0],
    evidence:["contiguous indexed writes","counter increases once per append","copy width matches a stable field","capacity times stride matches allocation payload"]};
}

export function inferPairGrid({domains,points}) {
  if(!domains||domains.length!==2||domains.some(d=>!d.observedIndexResolution)||domains[0].id===domains[1].id) return null;
  if(!points.every(p=>domains[0].keys.includes(p.coordinates[0])&&domains[1].keys.includes(p.coordinates[1]))) return null;
  return {view:"sparse-cartesian-projection",axes:domains.map(d=>d.id),points:points.length,
    memoryIsTwoDimensional:false,unvisitedCells:"unobserved, not allocated cells",
    evidence:["two independently resolved index domains","observed pair-field data flow"]};
}

export function inferBitset({wordBits,wordCount,operations}) {
  if(wordBits!==64||!wordCount||!operations.length||!operations.every(o=>o.word>=0&&o.word<wordCount&&o.bit>=0&&o.bit<wordBits)) return null;
  return {view:"bitset",bitCount:wordBits*wordCount,evidence:["fixed-width integer words","observed single-bit shift/or updates"],bitsAreStrings:true};
}

export function proposeViews(facts) {
  return {
    references:facts.referenceGroups.map(g=>({id:g.id,...topology(g.nodes,g.edges)})),
    containers:facts.containers.map(c=>({id:c.id,inference:inferDynamicArray(c.samples)})),
    pairGrid:inferPairGrid(facts.pairGrid),
    discoveryTree:facts.discoveryTree?.nodes.length ? {...topology(facts.discoveryTree.nodes,facts.discoveryTree.edges),
      evidence:["observed first-discovery parent indices","indices resolve within the same append-only record array"]}:null,
    bitset:inferBitset(facts.bitset),
    flexibleBitsets:(facts.flexibleBitsets||[]).filter(b=>b.copiedFromObservedBitset).map(b=>({id:b.id,view:"bitset",
      capacityBits:b.words.length*64,logicalBits:b.logicalBits,wordsHex:b.words,
      evidence:["observed bit operations in source storage","observed byte copy into flexible member"]})),
    fieldReferences:(facts.fieldReferences||[]).length ? {view:"references-to-fields",count:facts.fieldReferences.length,
      evidence:["pointer targets resolved to actual member addresses","indirect store updates that member"]}:null,
    dispatchTables:(facts.callTables||[]).filter(t=>t.hasFunctionField&&t.verifiedTargets>0).map(t=>({id:t.id,view:"function-dispatch-array",rows:t.rows,
      observedRows:t.observedRows,evidence:["function-pointer field in fixed-stride records","actual indirect callee entry verified"]})),
    indexedGraph: facts.indexLinks.length ? {view:"directed-graph",evidence:["observed index resolution and transition-cache writes"],
      edges:facts.indexLinks.length,uncachedEntries:"uncomputed"}:null,
    lookupTables:facts.lookupTables.map(t=>({id:t.id,view:"array",capacity:t.capacity,knownCells:t.knownCells,
      gridSuggestion:false,evidence:["indexed fixed-width storage"],unobservedCells:"unknown"})),
  };
}
