import { createHash } from "node:crypto";

const runtime = String.raw`
/* Observation runtime: excluded from GCC function instrumentation. */
static unsigned long tr_count;
static void tr_raw(int site, uintptr_t object, uintptr_t a, uintptr_t b,
                   uint64_t x, uint64_t y, uint64_t z) __attribute__((no_instrument_function));
static void tr_raw(int site, uintptr_t object, uintptr_t a, uintptr_t b,
                   uint64_t x, uint64_t y, uint64_t z) {
    if (++tr_count > 200000) { fputs("TRACE LIMIT\n", stderr); exit(90); }
    fprintf(stderr,"@CV {\"site\":%d,\"o\":\"0x%016" PRIxPTR "\",\"a\":\"0x%016" PRIxPTR "\",\"b\":\"0x%016" PRIxPTR "\",\"x\":\"%" PRIu64 "\",\"y\":\"%" PRIu64 "\",\"z\":\"%016" PRIx64 "\"}\n",
            site,object,a,b,x,y,z);
}
#define TR(S,O,A,B,X,Y,Z) tr_raw((S),(uintptr_t)(O),(uintptr_t)(A),(uintptr_t)(B),(uint64_t)(X),(uint64_t)(Y),(uint64_t)(Z))
void __cyg_profile_func_enter(void *, void *) __attribute__((no_instrument_function));
void __cyg_profile_func_exit(void *, void *) __attribute__((no_instrument_function));
void __cyg_profile_func_enter(void *fn, void *caller) { TR(-1,fn,caller,0,0,0,0); }
void __cyg_profile_func_exit(void *fn, void *caller) { TR(-2,fn,caller,0,0,0,0); }
`;

// Curated observation sites for this fixture. This is not a general C transformer.
export function instrumentRegex(bytes) {
  const original = bytes.toString("utf8"), source = original.replace(/\r\n/g, "\n");
  const sites = [], edits = [];
  const locate = (anchor, count = 1) => {
    const positions = []; let at = 0;
    while ((at = source.indexOf(anchor, at)) !== -1) { positions.push(at); at += anchor.length; }
    if (positions.length !== count) throw new Error(`계측 위치 불일치 (${positions.length}/${count}): ${anchor.slice(0, 90)}`);
    return positions;
  };
  function hook(anchor, build, { count = 1, placement = "after" } = {}) {
    for (const position of locate(anchor, count)) {
      const make = (kind, category, fields = {}) => {
        const id = sites.length + 1;
        sites.push({ id, instructionId: `r${id}`, kind, category,
          source: { file: "regex_equivalence.c", line: source.slice(0, position).split("\n").length }, ...fields });
        return id;
      };
      const insertion = build(make);
      edits.push({ start: placement === "after" ? position + anchor.length : position,
        end: placement === "replace" ? position + anchor.length : placement === "after" ? position + anchor.length : position,
        text: placement === "replace" ? insertion : `\n${insertion}\n` });
    }
  }
  hook("#include <time.h>", () => runtime);
  hook("int main(int argc, char **argv) {", s => {
    const profile=s("SPACE","layout.profile");
    const vector=s("SPACE","layout.vector",{typeId:"T3"});
    const vectorFields=s("SPACE","layout.vector-fields",{typeId:"T3"});
    const ports=s("SPACE","layout.ports",{typeId:"T2"});
    const fields=s("SPACE","layout.records");
    const calls=s("SPACE","layout.call-table",{typeId:"T9"});
    return `TR(${profile},0,0,0,sizeof(void *),sizeof(size_t),sizeof(uint64_t));
TR(${vector},0,0,0,sizeof(Vector),_Alignof(Vector),offsetof(Vector,data));
TR(${vectorFields},0,0,0,offsetof(Vector,length),offsetof(Vector,capacity),offsetof(Vector,item_size));
TR(${ports},0,0,0,sizeof(NfaState),offsetof(NfaState,out),2);
TR(${fields},0,0,0,sizeof(Ast),sizeof(ProductNode),sizeof(CharSet));
TR(${calls},AST_OPERATIONS,&AST_OPERATIONS[0].build,0,sizeof(AST_OPERATIONS),sizeof(AstOperation),offsetof(AstOperation,build));`;
  });
  hook("static _Noreturn void fail(Context *ctx, const char *format, ...) {", s =>
    `TR(${s("ERROR","error")},ctx,0,0,0,0,0);`);
  hook("ctx->stats = stats;", s => `TR(${s("SPACE","context.begin")},ctx,0,0,sizeof *ctx,0,0);`);
  hook("free(ctx);", s => {
    const id=s("SPACE","context.end");
    return `uintptr_t tr_dead_context=(uintptr_t)ctx;\nfree(ctx);\ntr_raw(${id},tr_dead_context,0,0,0,0,0);`;
  },{count:2,placement:"replace"});
  hook("memset(block->payload, 0, size);", s => `TR(${s("SPACE","allocation.begin",{typeId:"T5"})},block,block->payload,ctx,total,size,offsetof(ArenaBlock,payload));
TR(${s("WRITE","reference",{typeId:"T5",field:"next"})},block,block->next,ctx,offsetof(ArenaBlock,next),0,0);
TR(${s("WRITE","zero-range")},block->payload,block,0,size,0,0);`);
  hook("free(block);", s => {
    const id=s("SPACE","allocation.end");
    return `uintptr_t tr_dead_block=(uintptr_t)block;\nfree(block);\ntr_raw(${id},tr_dead_block,0,0,0,0,0);`;
  },{placement:"replace"});
  hook("static void vector_push(Context *ctx, Vector *v, const void *item) {", s =>
    `void *tr_old_data=v->data;\nsize_t tr_old_length=v->length;\nTR(${s("READ","container.before",{typeId:"T3"})},v,v->data,item,v->length,v->capacity,v->item_size);`);
  hook("if (v->length) memcpy(data, v->data, v->length * v->item_size);", s =>
    `if(v->length) TR(${s("WRITE","range.copy")},v,data,v->data,v->length*v->item_size,0,0);`);
  hook("++v->length;", s => `TR(${s("WRITE","container.after",{typeId:"T3"})},v,v->data,tr_old_data,v->length,v->capacity,v->item_size);
TR(${s("WRITE","indexed.store",{typeId:"T3"})},v,(unsigned char *)v->data+tr_old_length*v->item_size,item,tr_old_length,v->item_size,v->length);`);
  const registerVector = (anchor, address, owner) => hook(anchor, s =>
    `TR(${s("SPACE","container.begin",{typeId:"T3",owner:owner==="0"?"activation":"record"})},${address},${owner},0,sizeof(Vector),0,0);`);
  registerVector("Vector line = { .item_size = sizeof(unsigned char) };", "&line", "0");
  registerVector("Vector frames = { .item_size = sizeof(BuildFrame) };", "&frames", "0");
  registerVector("Vector results = { .item_size = sizeof(Fragment) };", "&results", "0");
  registerVector("nfa->states.item_size = sizeof(NfaState *);", "&nfa->states", "nfa");
  registerVector("dfa->states.item_size = sizeof(DfaState *);", "&dfa->states", "dfa");
  registerVector("product->nodes.item_size = sizeof(ProductNode);", "&product->nodes", "product");
  hook("Nfa nfas[2] = {{0}};", s => `TR(${s("SPACE","owner.begin",{typeId:"T10"})},&nfas[0],0,0,0,0,sizeof(Nfa));
TR(${s("SPACE","owner.begin",{typeId:"T10"})},&nfas[1],0,0,1,0,sizeof(Nfa));`);
  hook("Dfa dfas[2] = {{0}};", s => `TR(${s("SPACE","owner.begin",{typeId:"T11"})},&dfas[0],0,0,0,0,sizeof(Dfa));
TR(${s("SPACE","owner.begin",{typeId:"T11"})},&dfas[1],0,0,1,0,sizeof(Dfa));`);
  hook("Product product = {0};", s => `TR(${s("SPACE","owner.begin",{typeId:"T12"})},&product,0,0,0,0,sizeof(Product));`);
  hook("node->kind = kind;", s => `TR(${s("SPACE","record.begin",{typeId:"T1"})},node,0,0,kind,sizeof *node,0);`);
  for(const [anchor,field] of [["node->as.pair.left = left;","as.pair.left"],["node->as.pair.right = right;","as.pair.right"],["parent->as.child = node;","as.child"]]) {
    const object=anchor.startsWith("parent")?"parent":"node", value=anchor.includes("= left")?"left":anchor.includes("= right")?"right":"node";
    hook(anchor,s=>`TR(${s("WRITE","reference",{typeId:"T1",field})},${object},${value},0,offsetof(Ast,${field}),0,0);`);
  }
  hook("roots[i] = parse_regex(ctx, patterns[i].text, patterns[i].length, i + 1);",s=>
    `TR(${s("WRITE","root.reference",{typeId:"T1"})},roots,roots[i],0,i,0,0);`);
  hook("state->kind = kind;", s => `TR(${s("SPACE","record.begin",{typeId:"T2"})},state,nfa,&state->out[0],state->id,kind,sizeof *state);
TR(${s("SPACE","field.ports",{typeId:"T2"})},state,&state->out[0],&state->out[1],0,0,0);`);
  hook("patch->slot = slot;",s=>`TR(${s("SPACE","record.begin",{typeId:"T4"})},patch,slot,0,sizeof *patch,0,0);`);
  hook("a.last->next = b.first;",s=>`TR(${s("WRITE","reference",{typeId:"T4",field:"next"})},a.last,b.first,0,offsetof(Patch,next),0,0);`);
  hook("*p->slot = target;",s=>{
    const read=s("READ","indirect.slot.read",{typeId:"T4"}),write=s("WRITE","indirect.slot.write",{typeId:"T4"});
    return `NfaState **tr_slot=p->slot;\nTR(${read},p,tr_slot,*tr_slot,0,0,0);\n*tr_slot = target;\nTR(${write},p,tr_slot,target,0,0,0);`;
  },{placement:"replace"});
  hook("state->out[0] = a.start;",s=>`TR(${s("WRITE","reference",{typeId:"T2",field:"out[0]"})},state,a.start,&state->out[0],0,0,0);`,{count:4});
  hook("state->out[1] = b.start;",s=>`TR(${s("WRITE","reference",{typeId:"T2",field:"out[1]"})},state,b.start,&state->out[1],1,0,0);`);
  hook("Fragment result = op->build(nfa, frame.node, a, b);",s=>{
    const read=s("READ","call.target"),enter=s("FLOW","indirect.enter"),returned=s("WRITE","call.result");
    return `unsigned tr_target=AST_KIND_COUNT;\nfor(unsigned tr_i=0;tr_i<AST_KIND_COUNT;tr_i++) if(AST_OPERATIONS[tr_i].build==op->build) tr_target=tr_i;
TR(${read},&op->build,nfa,frame.node,tr_target,op->arity,0);
TR(${enter},nfa,frame.node,0,tr_target,0,0);
Fragment result = op->build(nfa, frame.node, a, b);
TR(${returned},nfa,result.start,result.first,tr_target,0,0);`;
  },{placement:"replace"});
  hook("set->words[byte / 64] |= UINT64_C(1) << (byte % 64);",s=>
    `TR(${s("CALC","bitwise.result",{typeId:"T8"})},set,0,0,byte/64,byte%64,set->words[byte/64]);`);
  hook("state->hash = hash;",s=>`TR(${s("SPACE","record.begin",{typeId:"T6"})},state,dfa,0,state->id,dfa->word_count,state->hash);`);
  hook("dfa->nfa = nfa;",s=>`TR(${s("WRITE","reference",{typeId:"T11",field:"source-record"})},dfa,nfa,0,0,0,0);`);
  hook("dfa->scratch = arena_array(ctx, dfa->word_count, sizeof *dfa->scratch);",s=>
    `TR(${s("SPACE","bitset.begin",{typeId:"T13"})},dfa->scratch,dfa,nfa,dfa->word_count,nfa->states.length,64);`);
  hook("dfa->scratch[state->id / 64] |= UINT64_C(1) << (state->id % 64);",s=>
    `TR(${s("CALC","bitwise.result",{typeId:"T13"})},dfa->scratch,dfa,state,state->id/64,state->id%64,dfa->scratch[state->id/64]);`);
  hook("memcpy(state->subset, dfa->scratch, bytes);",s=>{
    const copy=s("WRITE","bitset.copy",{typeId:"T6"}),word=s("WRITE","bitset.word",{typeId:"T6"});
    return `TR(${copy},state,state->subset,dfa->scratch,bytes,0,0);
for(size_t tr_word=0;tr_word<dfa->word_count;tr_word++) TR(${word},state,state->subset,0,tr_word,64,state->subset[tr_word]);`;
  });
  hook("dfa->buckets[slot] = state;",s=>`TR(${s("WRITE","record.ready",{typeId:"T6"})},state,dfa,state->next,state->id,state->accepting,dfa->word_count);
TR(${s("WRITE","lookup.store")},dfa,dfa->buckets,state,slot,dfa->bucket_count,state->id);`);
  hook("from->next[symbol] = destination;",s=>`TR(${s("WRITE","index.link",{typeId:"T6"})},dfa,from,((DfaState **)dfa->states.data)[destination],id,symbol,destination);`);
  hook("nfa->start = result.start;",s=>`TR(${s("WRITE","graph.roots",{typeId:"T2"})},nfa,nfa->start,nfa->accept,0,0,0);`);
  hook("product->buckets[slot] = id + 1;",s=>`TR(${s("WRITE","pair.insert",{typeId:"T7"})},product,(ProductNode *)product->nodes.data+id,0,id,node.left,node.right);
TR(${s("WRITE","parent.index",{typeId:"T7"})},product,0,0,id,node.parent,node.depth);
TR(${s("WRITE","lookup.store")},product,product->buckets,0,slot,product->bucket_count,id+1);`);
  hook("InternResult found = product_intern(product, next);",s=>
    `TR(${s("WRITE","pair.link",{typeId:"T7"})},product,left,right,head,found.id,left->alphabet->bytes[symbol]);`);
  hook("witness[i - 1] = nodes[id].via;",s=>`TR(${s("WRITE","byte.store")},witness,&nodes[id],0,i-1,0,witness[i-1]);`);
  for(const anchor of ["dfa->buckets = buckets;","product->buckets = buckets;"]) hook(anchor,s=>{
    const object=anchor.startsWith("dfa")?"dfa":"product";
    return `TR(${s("WRITE","indexed.lookup-array")},${object},buckets,0,capacity,sizeof *buckets,0);`;
  });
  const sorted=edits.sort((a,b)=>a.start-b.start||a.end-b.end);
  for(let i=1;i<sorted.length;i++) if(sorted[i].start<sorted[i-1].end) throw new Error("계측 편집 범위가 겹칩니다.");
  let instrumented=source;
  for(const edit of [...sorted].reverse()) instrumented=instrumented.slice(0,edit.start)+edit.text+instrumented.slice(edit.end);
  return {source:instrumented,plan:{schemaVersion:1,source:{file:"regex_equivalence.c",sha256:createHash("sha256").update(bytes).digest("hex")},
    method:"curated source hooks plus GCC -finstrument-functions; not general automatic AST instrumentation",
    coverage:"all user function entry/exit; selected typed allocation, reference, copy, bitset and index operations; other reads/calculations and libc internals are unobserved",
    sites,types:{T1:{kind:"record",selfReferences:"union variants"},T2:{kind:"record",selfReferences:"fixed pointer array",count:2},
      T3:{kind:"record",fields:["opaque-pointer","size","size","size"]},T4:{kind:"record",selfReferences:"one pointer",indirectFieldReference:true},
      T5:{kind:"record",selfReferences:"one pointer",flexiblePayload:true},T6:{kind:"record",flexibleIntegers:64,indexArray:true},
      T7:{kind:"record",fields:["index","index","index","size","byte"]},T8:{kind:"array",elementBits:64,count:4}}}};
}
