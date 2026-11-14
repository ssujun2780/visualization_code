import {referenceEdges, cellId} from './memory.js';

const owner = object => object.frameId ? `frame:${object.frameId}` : `memory:${object.storage === 'heap' ? 'heap' : 'static'}`;
export function pointerGraph(state, geometry, pinned = new Set()) {
  const regions = [...geometry.mats.values()].filter(mat => mat.alive && !mat.id.startsWith('tool:')).map(mat => ({id: mat.id, ...mat.rectangle}));
  const barriers = [...geometry.mats.values()].filter(mat => mat.alive && mat.id.startsWith('tool:')).map(mat => ({id: mat.id, ...mat.rectangle}));
  const nodes = [];
  for (const port of geometry.ports?.values() ?? geometry.cells.values()) {
      const object = state.objects.get(port.objectId); if (!object?.alive) continue;
      const rectangle = port;
      const padding = object.renderCells?.length ? 0 : 27;
      nodes.push({id: port.id ?? cellId(object.id), region: owner(object), objectId: object.id, offset: port.offset,
        x: rectangle.x, y: rectangle.y - padding, width: rectangle.width, height: rectangle.height + padding,
        pinned: pinned.has(`object:${object.id}`) || pinned.has(owner(object))});
  }
  const locate = (id, offset) => {
    const object = state.objects.get(id);
    const cells = object?.renderCells;
    return cells?.length ? cells.find(c => offset >= c.offset && offset < c.offset + c.size)?.id : cellId(id);
  };
  const references = referenceEdges(state), edges = [], inactive = [], hiddenEdges = [];
  for (const edge of references) {
    const sourceLogicalId = locate(edge.sourceObjectId, edge.sourceOffset);
    const aggregateTarget = ['array', 'record'].includes(edge.targetKind) && [...(geometry.containers?.values() ?? [])].find(g =>
      g.objectId === edge.targetObjectId && g.offset === edge.targetOffset && g.size === edge.targetSize);
    const targetLogicalId = aggregateTarget?.id ?? locate(edge.targetObjectId, edge.targetOffset);
    const source = geometry.anchors?.get(sourceLogicalId) ?? sourceLogicalId, target = geometry.anchors?.get(targetLogicalId) ?? targetLogicalId;
    if (!state.objects.get(edge.targetObjectId)?.alive || edge.onePast || !['in-bounds', undefined].includes(edge.status) || !source || !target) {
      inactive.push({...edge, source, sourceLogicalId, targetLogicalId}); continue;
    }
    const projected = {...edge, source, target, sourceLogicalId, targetLogicalId};
    if (source === target && source !== sourceLogicalId && target !== targetLogicalId) hiddenEdges.push(projected);
    else edges.push(projected);
  }
  return {nodes, regions, barriers, edges, inactive, hiddenEdges};
}

export function graphKey(graph) {
  // Values, labels and camera coordinates are intentionally excluded.
  return JSON.stringify([...(graph.barriers ?? []).map(r => [r.id, r.x, r.y, r.width, r.height]), graph.regions.map(r => [r.id, r.x, r.y, r.width, r.height]),
    graph.nodes.map(n => [n.id, n.region, n.x, n.y, n.width, n.height, n.pinned]),
    graph.edges.map(e => [e.id, e.source, e.target])]);
}
