// Pure Clang text-AST reader shared by browser diagnostics and the Node model.
export function astNodes(dump) {
  const nodes=[],stack=[];let current={file:null,line:1,column:1};
  for(const line of dump.split("\n")) {
    const empty=/^([ |`-]*)<<<NULL>>>/.exec(line);
    if(empty){const parent=stack[empty[1].length/2-1];if(parent)parent.childSlots.push(null);continue;}
    const m=/^([ |`-]*)([A-Za-z]\w*)\s+(0x[0-9a-f]+)\b(.*)$/.exec(line);if(!m)continue;
    const depth=m[1].length/2;if(!Number.isInteger(depth))continue;
    const details=m[4],header=details.split("'")[0],range=/<([^<>]+)>/.exec(header),points=[];
    for(const loc of header.matchAll(/(\/[^<>,]*?):(\d+):(\d+)|line:(\d+):(\d+)|col:(\d+)/g)) {
      current=loc[1]?{file:loc[1].trim(),line:Number(loc[2]),column:Number(loc[3])}:
        {file:current.file,line:loc[4]?Number(loc[4]):current.line,column:Number(loc[5]??loc[6])};
      if(range&&loc.index>=range.index&&loc.index<range.index+range[0].length)points.push({...current});
    }
    const parent=stack[depth-1],quotes=[...details.matchAll(/'([^']*)'/g)].map(q=>q[1]);
    const node={id:`ast${nodes.length+1}`,astId:m[3],kind:m[2],details,depth,parent,children:[],type:quotes[0],canonical:details.includes("':'")?quotes[1]:quotes[0],
      childSlots:[],functionName:parent?.functionName,declarationPoint:{...current},source:points.length&&points.every(p=>p.file===points[0].file)?{file:points[0].file,start:points[0],end:points.at(-1)}:null};
    if(node.kind==="FunctionDecl")node.functionName=/\s([^\s']+)\s+'/.exec(details)?.[1];
    if(parent){parent.children.push(node);parent.childSlots.push(node);}nodes.push(node);stack[depth]=node;stack.length=depth+1;
  }
  return nodes;
}
