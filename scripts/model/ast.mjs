// Pure Clang text-AST reader shared by browser diagnostics and the Node model.
export function astNodes(dump) {
  const nodes=[],stack=[];let current={file:null,line:1,column:1};
  for(const line of dump.split("\n")) {
    const empty=/^([ |`-]*)<<<NULL>>>/.exec(line);
    if(empty){const parent=stack[empty[1].length/2-1];if(parent)parent.childSlots.push(null);continue;}
    const association=/^([ |`-]*)(case\s+'([^']*)'(?::'([^']*)')?|default)(\s+selected)?\s*$/.exec(line);
    if(association){
      const depth=association[1].length/2,parent=stack[depth-1];if(parent?.kind!=='GenericSelectionExpr')continue;
      const node={id:`ast${nodes.length+1}`,astId:`${parent.astId}:association:${parent.children.filter(c=>c.kind==='GenericAssociation').length}`,
        kind:'GenericAssociation',details:association[2],depth,parent,children:[],childSlots:[],
        type:association[3]??null,canonical:association[4]??association[3]??null,isDefault:association[2]==='default',selected:!!association[5],
        functionName:parent.functionName,source:null,spellingRange:null,declarationPoint:null};
      parent.children.push(node);parent.childSlots.push(node);nodes.push(node);stack[depth]=node;stack.length=depth+1;continue;
    }
    const m=/^([ |`-]*)([A-Za-z]\w*)\s+(0x[0-9a-f]+)\b(.*)$/.exec(line);if(!m)continue;
    const depth=m[1].length/2;if(!Number.isInteger(depth))continue;
    const details=m[4],header=details.split("'")[0],start=header.indexOf('<'),end=header.lastIndexOf('>'),points=[];
    const range=start>=0&&end>=start?{index:start,length:end-start+1}:null;
    for(const loc of header.matchAll(/(\/[^<>,]*?|<scratch space>|<built-in>|<command line>):(\d+):(\d+)|line:(\d+):(\d+)|col:(\d+)/g)) {
      current=loc[1]?{file:loc[1].trim(),line:Number(loc[2]),column:Number(loc[3])}:
        {file:current.file,line:loc[4]?Number(loc[4]):current.line,column:Number(loc[5]??loc[6])};
      if(range&&loc.index>=range.index&&loc.index<range.index+range.length)points.push({...current});
    }
    const parent=stack[depth-1],quotes=[...details.matchAll(/'([^']*)'/g)].map(q=>q[1]);
    const node={id:`ast${nodes.length+1}`,astId:m[3],kind:m[2],details,depth,parent,children:[],type:quotes[0],canonical:details.includes("':'")?quotes[1]:quotes[0],
      childSlots:[],functionName:parent?.functionName,declarationPoint:{...current},
      spellingRange:points.length?{start:points[0],end:points.at(-1)}:null,
      source:points.length&&points.every(p=>p.file===points[0].file)?{file:points[0].file,start:points[0],end:points.at(-1)}:null};
    if(node.kind==="FunctionDecl"){
      node.functionName=/\s([^\s']+)\s+'/.exec(details)?.[1];
      node.previousDeclarationASTId=/\bprev (0x[0-9a-f]+)\b/.exec(details)?.[1]??null;
      const specifiers=details.slice(details.lastIndexOf("'")+1);
      node.functionSpecifiers={inline:/\binline\b/.test(specifiers),storageClass:/\b(static|extern)\b/.exec(specifiers)?.[1]??null};
    }
    if(node.kind==='MemberExpr'){
      const field=/ (\.|->)(\S*) (0x[0-9a-f]+)(?:\s|$)/.exec(details);
      if(field){node.fieldASTId=field[3];node.memberName=field[2]||null;node.memberAccess=field[1];}
    }
    if(node.kind==='InitListExpr')node.selectedFieldASTId=/\bfield Field (0x[0-9a-f]+)/.exec(details)?.[1]??null;
    if(parent){parent.children.push(node);parent.childSlots.push(node);}nodes.push(node);stack[depth]=node;stack.length=depth+1;
  }
  for(const n of nodes.filter(n=>n.kind==='GenericSelectionExpr')){
    n.associations=n.children.filter(c=>c.kind==='GenericAssociation');n.selectedAssociation=n.associations.find(a=>a.selected)??null;
    n.controllingType=n.children.find(c=>c!==n.children[0]&&c.kind!=='GenericAssociation')?.type??n.children[0]?.type;
    const mark=(root,state)=>{const pending=[root];while(pending.length){const at=pending.pop();if(!at)continue;at.executionState=state;pending.push(...at.children);}};
    mark(n.children[0],'unevaluated');for(const a of n.associations)if(!a.selected)mark(a,'unselected');
  }
  return nodes;
}
