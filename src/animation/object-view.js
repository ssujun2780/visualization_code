import {cellId} from './memory.js';

export const containerId = (objectId, path = '') => `aggregate:${objectId}:${path}`;

export function visibleMemoryCells(object, geometry) {
  const values = new Map((object.renderCells ?? []).map(cell => [cell.id, cell]));
  return [...geometry.cells.values()].filter(box => box.objectId === object.id && !box.hidden && values.has(box.id))
    .map(box => ({...box, ...values.get(box.id)}));
}

// Containment and pointer adjacency are separate relations. A container never
// borrows the identity of its first element, even though their addresses match.
export function memoryTree(object) {
  if (!object.renderCells?.length) return {id: cellId(object.id), objectId: object.id, offset: 0, size: object.size,
    label: object.name, value: object.value, width: 128, height: 88, kind: 'cell'};
  const root = {id: containerId(object.id), objectId: object.id, path: '', label: object.name, offset: 0, size: object.size,
    cType: object.cType ?? object.viewType, kind: 'aggregate', children: []};
  const groups = new Map([[root.id, root]]);
  for (const cell of object.renderCells) {
    let parent = root;
    for (const ancestor of cell.ancestors ?? []) {
      if (!ancestor.path) continue;
      const id = containerId(object.id, ancestor.path);
      if (!groups.has(id)) {
        const node = {...ancestor, id, objectId: object.id, label: `${object.name}${ancestor.path}`, kind: 'aggregate', children: []};
        groups.set(id, node); parent.children.push(node);
      }
      parent = groups.get(id);
    }
    parent.children.push({...cell, label: `${object.name}${cell.path}`, kind: 'cell', width: 92, height: 60});
  }
  return root;
}

export function layoutMemory(object, collapsed = new Set(), windows = new Map()) {
  const tree = memoryTree(object), cells = new Map(), groups = new Map(), ports = new Map(), anchors = new Map();
  function measure(node) {
    if (node.kind === 'cell') return node;
    node.collapsed = collapsed.has(node.id);
    if (node.collapsed) return Object.assign(node, {width: 250, height: 82});
    node.children.forEach(measure);
    const window=windows.get(node.id);
    const width = window?.width??Math.max(210, Math.min(456,28+node.children.reduce((sum,child)=>sum+child.width+20,0)-20), ...node.children.map(child => child.width + 28));
    let x = 14, y = 48, row = 0;
    for (const child of node.children) {
      if (x > 14 && x + child.width > width - 14) { x = 14; y += row + 26; row = 0; }
      child.x = x; child.y = y; x += child.width + 20; row = Math.max(row, child.height);
      child.clipped=Boolean(window&&(child.x+child.width>width-14||child.y+child.height>window.height-24));
    }
    return Object.assign(node, {width, height:window?.height??Math.max(100, y + row + 18),windowed:Boolean(window),
      hiddenChildren:node.children.filter(child=>child.clipped).length,
      incomplete:node.children.reduce((sum,child)=>sum+(child.clipped?0:child.size??0),0)<node.size});
  }
  function place(node, x, y, hiddenBy = null) {
    const rectangle = {x, y, width: node.width, height: node.height};
    const anchor = hiddenBy ?? node.id; anchors.set(node.id, anchor);
    if (node.kind === 'cell') {
      const box = hiddenBy ? ports.get(hiddenBy) : rectangle;
      cells.set(node.id, {...node, x: box.x, y: box.y, width: box.width, height: box.height, hidden: Boolean(hiddenBy)});
      if (!hiddenBy) ports.set(node.id, {...node, ...rectangle});
      return;
    }
    const header = {...rectangle, height: 30};
    const toggle = {x: x + 5, y: y + 3, width: 27, height: 27};
    const resizeHandle={x:x+node.width-20,y:y+node.height-20,width:20,height:20};
    groups.set(node.id, {...node, ...rectangle, header, toggle,resizeHandle, hidden: Boolean(hiddenBy)});
    if (!hiddenBy) ports.set(node.id, {...node, ...(node.collapsed ? rectangle : header)});
    for (const child of node.children) {
      // Hidden descendants still keep logical identities and selection labels.
      if (node.collapsed && child.kind === 'aggregate') measure(child);
      place(child, x + (child.x ?? 0), y + (child.y ?? 0), hiddenBy ?? (node.collapsed||child.clipped ? node.id : null));
    }
  }
  measure(tree); place(tree, 0, 0);
  return {tree, cells, groups, ports, anchors, width: tree.width, height: tree.height};
}

export function connectionFocus(selection, edges) {
  const focusedEdges = new Set(), logicalIds = new Set();
  if (!selection) return {active: false, edges: focusedEdges, logicalIds};
  for(const id of selection.logicalIds??[selection.logicalId])if(id)logicalIds.add(id);
  if(selection.kind==='wire'){
    const edge=edges.find(edge=>edge.id===selection.id);
    if(edge){logicalIds.add(edge.sourceLogicalId);logicalIds.add(edge.targetLogicalId);}
  }
  const adjacency=new Map();
  for(const edge of edges)for(const id of [edge.sourceLogicalId,edge.targetLogicalId]){
    if(!adjacency.has(id))adjacency.set(id,[]);adjacency.get(id).push(edge);
  }
  const queue=[...logicalIds];
  for(let at=0;at<queue.length;at++)for(const edge of adjacency.get(queue[at])??[]){
    focusedEdges.add(edge.id);
    for(const id of [edge.sourceLogicalId,edge.targetLogicalId])if(!logicalIds.has(id)){logicalIds.add(id);queue.push(id);}
  }
  return {active: ['wire', 'cell', 'aggregate', 'object'].includes(selection.kind), edges: focusedEdges, logicalIds};
}

export function focusForTargets(targets,geometry){
  const logicalIds=new Set();
  for(const target of targets){
    if(!target?.objectId)continue;
    const start=target.offset??0,end=start+(target.size??1);
    let found=false;
    for(const cell of geometry.cells.values())if(cell.objectId===target.objectId&&cell.offset<end&&cell.offset+cell.size>start){logicalIds.add(cell.id);found=true;}
    if(!found&&geometry.containers.has(containerId(target.objectId)))logicalIds.add(containerId(target.objectId));
  }
  return logicalIds.size?{kind:'object',logicalIds:[...logicalIds]}:null;
}
