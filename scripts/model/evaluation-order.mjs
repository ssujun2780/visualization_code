import {llvmDefinition,llvmLocal,llvmSymbol,llvmName,splitTop,operand} from './llvm.mjs';

const operator=n=>/ '([+*/%&|^<>=!,~-]+)'(?:\s|$)/.exec(n.details)?.[1]??null;
const position=(a,b)=>a.line-b.line||a.column-b.column;
const walk=n=>[n,...n.children.flatMap(walk)];
const labelPattern=new RegExp(`^(${llvmSymbol}):`);
const branchLabels=text=>[...text.matchAll(new RegExp(`label %(${llvmSymbol})`,'g'))].map(m=>m[1]);
const rewriteLabel=(text,from,to)=>from===to?text:text.replace(
  new RegExp(`(label %|, %)(?:${from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})(?=[\\s,\\]])`,'g'),`$1${to}`);

// LLVM shares numbered slots between unnamed arguments, blocks and values.
// An unnamed entry or a block after a terminator need not have a printed label
// (Clang emits these after noreturn calls). Recover their ORIGINAL slots before
// moving instructions; otherwise renaming only %N uses creates dangling labels.
function explicitBlocks(header,items){
  const match=new RegExp(`@${llvmSymbol}\\(`).exec(header),open=match.index+match[0].length;
  let end=open,depth=1,next=0;
  for(;end<header.length;end++){if(header[end]==='(')depth++;if(header[end]===')'&&!--depth)break;}
  const args=splitTop(header.slice(open,end)).map(text=>{
    if(!text||text==='...')return text;
    const value=operand(text).value,numeric=/^%(\d+)$/.exec(value);
    if(numeric)next=Number(numeric[1])+1;
    else if(!value)return `${text} %${next++}`;
    return text;
  });
  const result=[];let needsBlock=true;
  for(const item of items){
    const code=item.text.trim();
    if(!code||code.startsWith(';')){result.push(item);continue;}
    if(item.label){
      if(/^\d+$/.test(item.label))next=Number(item.label)+1;
      needsBlock=false;
    }else{
      if(needsBlock){const label=String(next++);result.push({text:`${label}:`,label});needsBlock=false;}
      const definition=llvmDefinition.exec(item.text),numeric=definition&&/^%(\d+)$/.exec(definition[1]);
      if(numeric)next=Number(numeric[1])+1;
      if(/^(?:ret|br|switch|indirectbr|invoke|callbr|resume|catchswitch|catchret|cleanupret|unreachable)\b/.test(definition?.[2]??code))needsBlock=true;
    }
    result.push(item);
  }
  return {header:header.slice(0,open)+args.join(', ')+header.slice(end),items:result};
}

function renameNumberedLocals(text,prefix){
  // Quoted names, literal strings and comments are not numbered local uses.
  return text.replace(/"(?:[^"\\]|\\.)*"|;[^\n]*|%(\d+)\b|^(\d+):/gm,(token,value,block)=>
    value!==undefined?`%${prefix}${value}`:block!==undefined?`${prefix}${block}:`:token);
}
function failure(message,node){return Object.assign(new Error(`평가 순서 적용 실패: ${message}`),{
  name:'UnsupportedC',stage:'ir-conversion',source:node?.source,code:'evaluation-order-unresolved'});}

// Mandatory producer/consumer edges take priority. The chosen source direction
// breaks ties only among regions whose prerequisites are already satisfied.
function dependencyOrder(preferred,constraints){
  const pending=new Set(preferred),done=new Set(),order=[];
  while(pending.size){const next=preferred.find(k=>pending.has(k)&&constraints.every(c=>c.after!==k||done.has(c.before)));
    if(next===undefined)return null;
    pending.delete(next);done.add(next);order.push(next);
  }
  return order;
}
function withRuntimeOrder(preferred,runtime){
  const owned=new Set(runtime);let index=0;
  return preferred.map(k=>owned.has(k)?runtime[index++]:k);
}

// Order complete AST operand regions, never observed events. An operand's
// internal branches/PHIs stay together, including skipped logical/?: arms.
// This pass uses compiler identities and ranges; it does not parse C text.
export function orderEvaluationLLVM(llvm,observations,nodes,{evaluationOrder='left-to-right'}={}){
  if(!['left-to-right','right-to-left'].includes(evaluationOrder))throw failure('지원하지 않는 기본 평가 순서입니다.');
  const byNode=new Map(nodes.map(n=>[n.id,n])),groups=[];
  for(const n of nodes){
    if(!n.functionName||n.executionState||n.source?.file!=='/main.c')continue;
    let operands,reason='default-policy',op=operator(n);
    if(n.kind==='CallExpr')operands=n.children;
    else if(['BinaryOperator','CompoundAssignOperator','ArraySubscriptExpr'].includes(n.kind)){
      operands=n.children;if([',','&&','||'].includes(op))reason='c-language';
    }else if(['ConditionalOperator','BinaryConditionalOperator'].includes(n.kind)){
      groups.push({nodeId:n.id,kind:n.kind,operator:'?:',reason:'c-language',mode:'selected-arm-only',operandNodeIds:n.children.map(c=>c.id)});continue;
    }else continue;
    if(operands.length<2)continue;
    const order=operands.map((_,i)=>i);if(reason!=='c-language'&&evaluationOrder==='right-to-left')order.reverse();
    groups.push({nodeId:n.id,kind:n.kind,operator:op,reason,mode:'ordered-operands',operandNodeIds:operands.map(c=>c.id),order,
      depth:n.depth,functionName:n.functionName,observedOperands:[],status:'compiler-elided-or-unevaluated'});
  }
  const policy={version:1,default:evaluationOrder,origin:evaluationOrder==='left-to-right'?'model-default':'explicit-option',
    enforcedAt:'executable-llvm-before-observation',languageConstraints:['short-circuit','conditional-selection','comma-sequencing','data-dependencies'],
    priority:'mandatory-dependencies-before-direction',
    groups,transformations:[],sourceRewrites:0};
  const lines=llvm.split('\n'),functions=new Map(observations.functions.map(f=>[f.name,f])),output=[];
  for(let start=0;start<lines.length;start++){
    const header=lines[start],match=new RegExp(`^define .*?@(${llvmSymbol})\\(`).exec(header);
    if(!match){output.push(header);continue;}
    const name=llvmName(match[1]),fn=functions.get(name),body=[];
    while(++start<lines.length&&lines[start]!=='}')body.push(lines[start]);
    const ops=observations.instructions.filter(o=>o.functionId===fn?.id&&o.backendInstruction),queues=new Map();
    for(const o of ops){if(!queues.has(o.backendInstruction))queues.set(o.backendInstruction,[]);queues.get(o.backendInstruction).push(o);}
    const originalItems=[];
    for(let i=0;i<body.length;i++){
      let text=body[i];if(/^\s*switch\b/.test(text)&&!text.includes(']'))while(i+1<body.length&&!text.includes(']'))text+='\n'+body[++i];
      originalItems.push({text,op:queues.get(text.trim())?.shift(),label:labelPattern.exec(text)?.[1]});
    }
    const explicit=explicitBlocks(header,originalItems),items=explicit.items;
    let changed=false;
    for(const g of groups.filter(g=>g.functionName===name&&g.mode==='ordered-operands').sort((a,b)=>b.depth-a.depth)){
      const n=byNode.get(g.nodeId),children=g.operandNodeIds.map(id=>byNode.get(id)),ids=children.map(c=>new Set(walk(c).map(n=>n.id))),
        ancestors=new Set();for(let p=n;p;p=p.parent)ancestors.add(p.id);
      function owner(item){
        const o=item.op;if(!o||['object.begin','source.declaration','source.alias','stack.save','stack.restore'].includes(o.action))return -1;
        if(o.semanticNodeId){const exact=ids.findIndex(s=>s.has(o.semanticNodeId));if(exact>=0)return exact;
          if(o.semanticNodeId===g.nodeId&&n.kind==='CompoundAssignOperator'&&o.action==='load')return 0;
          // A consumer at its first operand's position is not that operand.
          return ancestors.has(o.semanticNodeId)?-2:-1;
        }
        const p=o.source;if(!p)return -1;
        const candidates=children.map((c,i)=>({c,i})).filter(({c})=>c.source?.file==='/main.c'&&
          position(c.source.start,p)<=0&&position(p,c.source.end)<=0);
        if(candidates.length!==1)return -1;
        const k=candidates[0].i;
        // A loop's closing jump often points at the first token of its body.
        // It is not part of a simple operand at that same source position.
        if(['branch','merge','select'].includes(o.action)&&!walk(children[k]).some(c=>['ConditionalOperator','BinaryConditionalOperator'].includes(c.kind)||
          c.kind==='BinaryOperator'&&['&&','||'].includes(operator(c))))return -1;
        return k;
      }
      const owners=items.map(owner),producers=new Map();
      for(const [i,item]of items.entries()){const m=llvmDefinition.exec(item.text);if(m)producers.set(m[1],i);}
      // GEP/load/cast instructions may share the base token's debug location.
      // If they consume another operand (or the combined address), they are
      // the expression consumer, not an evaluation of that base token.
      for(let pass=0;pass<items.length;pass++){
        let updated=false;
        for(const [i,item]of items.entries()){
          const definition=llvmDefinition.exec(item.text);
          if(owners[i]===-2||!definition||/\b(?:call|invoke|callbr)\b/.test(definition[2])||ids.some(s=>s.has(item.op?.semanticNodeId)))continue;
          const rhs=definition[2],dependencies=[...rhs.matchAll(new RegExp(llvmLocal,'g'))]
            .map(m=>owners[producers.get(m[0])]).filter(k=>k!==undefined);
          const operandDependencies=new Set(dependencies.filter(k=>k>=0));
          if(dependencies.includes(-2)||owners[i]>=0&&[...operandDependencies].some(k=>k!==owners[i])||operandDependencies.size>1){owners[i]=-2;updated=true;}
        }
        if(!updated)break;
      }
      const owned=new Map();for(const [i,k]of owners.entries())if(k>=0){if(!owned.has(k))owned.set(k,[]);owned.get(k).push(i);}
      g.observedOperands=[...owned.keys()];
      g.effectiveOrder=[...g.order];g.constraints=[];
      if(owned.size<2){g.status='no-competing-runtime-operands';continue;}
      const actual=[...owned.keys()].sort((a,b)=>owned.get(a)[0]-owned.get(b)[0]),preferred=g.order.filter(k=>owned.has(k));
      g.observedOperands=actual;g.effectiveOrder=withRuntimeOrder(g.order,actual);
      const preserve=reason=>{g.status='compiler-order-preserved';g.preservedBecause=reason;};
      // Sequenced/selected operands are already lowered by Clang. They are
      // hard boundaries, not candidates for the optional direction policy.
      if(g.reason==='c-language'){g.effectiveOrder=[...g.order];preserve('c-language-sequencing');continue;}
      const begins=actual.map(k=>owned.get(k)[0]),end=Math.max(...[...owned.values()].flat())+1,first=begins[0];
      if(actual.some((k,i)=>owned.get(k).at(-1)>=(begins[i+1]??end))){
        preserve('interleaved-operand-regions');g.effectiveOrder=null;
        g.observedOperandSequence=owners.filter(k=>k>=0).filter((k,i,a)=>!i||k!==a[i-1]);continue;
      }
      g.status='compiler-order-verified';
      if(actual.every((k,i)=>k===preferred[i]))continue;
      const blockAt=index=>{for(let j=index-1;j>=0;j--)if(items[j].label)return items[j].label;return 'entry';};
      const regions=new Map(actual.map((k,i)=>{const a=begins[i],b=begins[i+1]??end,chunk=items.slice(a,b);
        return [k,{chunk,entry:blockAt(a),exit:blockAt(b),labels:new Set(chunk.map(x=>x.label).filter(Boolean))}];}));
      // Each movable region must have no external entry/exit inside its CFG.
      // Return/goto/exception regions cannot silently be relocated.
      let boundary=null;
      for(const r of regions.values()){
        if(r.chunk.findLast(item=>item.text.trim()&&!item.text.trim().startsWith(';'))?.label)boundary='external-control-flow';
        for(const item of r.chunk){
          if(/^\s*(ret|indirectbr|invoke|callbr|resume)\b/.test(item.text))boundary='nonlocal-control-flow';
          if(branchLabels(item.text).some(l=>!r.labels.has(l)))boundary='external-control-flow';
        }
        for(const item of items)if(!r.chunk.includes(item)&&branchLabels(item.text).some(l=>r.labels.has(l)))
          boundary='external-control-flow';
      }
      if(boundary){preserve(boundary);continue;}
      // Do not drag an expression consumer into an operand just because its
      // instructions lie between two source-labelled regions. A consumer inside
      // a nested operand is excluded by the AST ownership check above.
      if([...regions.values()].some(r=>r.chunk.some(item=>owners[items.indexOf(item)]===-2))){preserve('expression-consumer-boundary');continue;}
      // LLVM SSA dependencies are mandatory even where C permits a choice.
      const definitions=new Map();for(const [k,r]of regions)for(const item of r.chunk){const m=llvmDefinition.exec(item.text);if(m)definitions.set(m[1],k);}
      for(const [k,r]of regions)for(const item of r.chunk){const m=llvmDefinition.exec(item.text),rhs=m?.[2]??item.text;
        for(const use of rhs.matchAll(new RegExp(llvmLocal,'g'))){const producer=definitions.get(use[0]);
          if(producer!==undefined&&producer!==k&&!g.constraints.some(c=>c.before===producer&&c.after===k&&c.value===use[0]))
            g.constraints.push({before:producer,after:k,value:use[0],kind:'ssa-dependency'});}}
      // SSA use-def edges do not include memory dependencies. In particular an
      // ABI coercion load may be labelled at the callee token even though its
      // compound literal must be initialized by a later source operand first.
      const memoryRoot=(value,seen=new Set())=>{
        if(!value||seen.has(value))return null;seen.add(value);
        const item=items[producers.get(value)],o=item?.op;
        if(!item)return value;
        if(o?.action==='address')return memoryRoot(o.pointer?.value,seen);
        if(o?.action==='convert'&&['bitcast','addrspacecast'].includes(o.opcode))return memoryRoot(o.inputs?.[0]?.value,seen);
        return value;
      };
      const memory=[];
      for(const k of actual)for(const item of regions.get(k).chunk){const o=item.op;
        if(!['load','store'].includes(o?.action))continue;
        const root=memoryRoot(o.pointer?.value);if(!root)continue;
        for(const prior of memory)if(prior.root===root&&prior.owner!==k&&(prior.write||o.action==='store')&&
          !g.constraints.some(c=>c.before===prior.owner&&c.after===k&&c.value===root))
          g.constraints.push({before:prior.owner,after:k,value:root,kind:'memory-dependency'});
        memory.push({root,owner:k,write:o.action==='store'});
      }
      const wanted=dependencyOrder(preferred,g.constraints);
      if(!wanted){preserve('cyclic-region-dependencies');g.unresolvedDependencies=g.constraints;g.constraints=[];g.effectiveOrder=null;continue;}
      g.effectiveOrder=withRuntimeOrder(g.order,wanted);
      if(actual.every((k,i)=>k===wanted[i])){preserve('mandatory-dependencies');continue;}
      // Defensive check on the resulting schedule, never a request to override
      // an actual dependency in order to force the preferred direction.
      const rank=new Map(wanted.map((k,i)=>[k,i]));
      if(g.constraints.some(c=>rank.get(c.before)>=rank.get(c.after)))throw failure('의존성 순서 계획이 올바르지 않습니다.',n);
      const oldExit=blockAt(end);let current=blockAt(first);const arranged=[];
      for(const k of wanted){const r=regions.get(k);for(const item of r.chunk){
        item.text=rewriteLabel(item.text,r.entry,current);arranged.push(item);
      }if(r.labels.size)current=r.exit;}
      // The following PHI now receives its value from the new exit block.
      for(let i=end;i<items.length;i++)if(/\bphi\b/.test(items[i].text))items[i].text=rewriteLabel(items[i].text,oldExit,current);
      items.splice(first,end-first,...arranged);changed=true;g.status='ordered-before-execution';g.observedOperands=wanted;
      policy.transformations.push({nodeId:g.nodeId,functionName:name,before:actual,after:wanted,internalControlFlowPreserved:true,
        dependencyConstrained:g.constraints.length>0});
    }
    let functionText=changed?[explicit.header,...items.map(i=>i.text),'}'].join('\n'):[header,...body,'}'].join('\n');
    if(changed){
      // Reordering numbered SSA instructions otherwise violates LLVM's textual
      // slot numbering, even though all value dependencies remain correct.
      const prefix='__cvm_evaluation_';if(functionText.includes(prefix))throw failure('예약된 LLVM 식별자와 충돌합니다.');
      functionText=renameNumberedLocals(functionText,prefix);
    }
    output.push(functionText);
  }
  for(const g of groups){delete g.depth;delete g.functionName;}
  return {llvm:policy.transformations.length?output.join('\n'):llvm,policy};
}

export function validateEvaluationOrderPlan(plan){
  const p=plan.evaluationOrder;if(!p)return;
  if(p.version!==1||!['left-to-right','right-to-left'].includes(p.default)||p.enforcedAt!=='executable-llvm-before-observation')
    throw new Error('평가 순서 정책이 올바르지 않습니다.');
  for(const g of p.groups){if(g.mode==='selected-arm-only')continue;
    if(g.order.length!==g.operandNodeIds.length||new Set(g.order).size!==g.order.length||g.order.some(i=>!Number.isInteger(i)||i<0||i>=g.order.length))
      throw new Error('피연산자 평가 순서가 올바르지 않습니다.');
    if(g.reason==='c-language'&&g.order.some((x,i)=>x!==i))throw new Error('C의 필수 평가 순서는 변경할 수 없습니다.');
    if(g.effectiveOrder!==undefined&&g.effectiveOrder!==null){
      if(g.effectiveOrder.length!==g.order.length||new Set(g.effectiveOrder).size!==g.order.length||g.effectiveOrder.some(k=>!g.order.includes(k)))
        throw new Error('실효 평가 순서가 올바르지 않습니다.');
      if(g.reason==='c-language'&&g.effectiveOrder.some((k,i)=>k!==i))throw new Error('C의 필수 평가 순서는 변경할 수 없습니다.');
      const ranks=new Map(g.effectiveOrder.map((k,i)=>[k,i]));
      if((g.constraints??[]).some(c=>!ranks.has(c.before)||!ranks.has(c.after)||ranks.get(c.before)>=ranks.get(c.after)))
        throw new Error('실효 평가 순서가 필수 값 의존성을 위반합니다.');
    }
  }
}
