import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const added=[];
function add(id,source,stdout,process,checks={}){added.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('29_macro_precedence',`#include <stdio.h>
#define PART 3+4
#define DOUBLE(x) ((x)+(x))
#define TEXT(x) #x
int main(void){
 int a=2*PART;
 int b=DOUBLE(5-1);
 int c=(PART)*2;
 printf("%d %d %d %s\\n",a,b,c,TEXT(PART));return 0;
}
`,'10 8 14 PART\n',['Unparenthesized PART expands 2*3+4=10; parenthesized (3+4)*2=14.','Macro stringification is literal PART, not3+4. Folded calculations must retain source/expanded grouping without inventing calls.']);
add('30_large_exact_integer',`#include <stdio.h>
int main(void){
 unsigned long long a=9007199254740993ULL;
 unsigned long long b=a+2ULL;
 long long n=-23;
 long long q=n/7,r=n%7;
 unsigned long long wrap=(unsigned long long)(-1LL);
 printf("%llu %llu %lld %lld %llu\\n",a,b,q,r,wrap-b);
 return 0;
}
`,'9007199254740993 9007199254740995 -3 -2 18437736874454810620\n',['64-bit values stay exact beyond JS safe integer; b is9007199254740995.','Negative C integer division truncates toward zero; remainder -2. Same-width signed->unsigned cast retains 64-bit all ones.']);
add('31_nan_truth',`#include <stdio.h>
#include <math.h>
int main(void){
 double a=NAN,b=INFINITY;
 int first=a==a;
 int second=a!=a;
 int third=(a<0.0)||(b>100.0);
 _Bool truth=a;
 printf("%d %d %d %d\\n",first,second,third,truth);
 return 0;
}
`,'0 1 1 1\n',['NaN comparisons equal false, unequal true; a<0 false; infinity>100 true.','NaN converts to true because unequal to zero; nonfinite floating values need unambiguous serialized bits/type.']);
add('32_unicode_positions',`#include <stdio.h>
int twice(int x){return x*2;}
int main(void){
\t/* 한글 주석: 📦 */ int 값=3;
\tint 합계=twice(값)+4;
\tprintf("결과=%d\\n",합계);
\treturn 0;
}
`.replaceAll('\n','\r\n'),'결과=10\n',['Korean identifiers/comments, supplementary Unicode emoji, tabs and CRLF change source byte/editor offsets.','Same source calculation and call semantics; box names and source ranges must preserve Korean identifiers.'],{calls:{twice:1}});
add('33_parser_recursion',`#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
typedef struct {const char *cursor;int ok;int operations;} Parser;
typedef struct {long value;int ok;} Result;
static Result expression(Parser *p);
static void space(Parser *p){while(isspace((unsigned char)*p->cursor))p->cursor++;}
static Result factor(Parser *p){
 space(p);Result result={0,1};
 if(*p->cursor=='('){
  p->cursor++;result=expression(p);space(p);
  if(*p->cursor!=')'){p->ok=0;result.ok=0;}else p->cursor++;
 }else{
  char *end;result.value=strtol(p->cursor,&end,10);
  if(end==p->cursor){p->ok=0;result.ok=0;}else p->cursor=end;
 }
 return result;
}
static Result term(Parser *p){
 Result value=factor(p);space(p);
 while(p->ok && *p->cursor=='*'){
  p->cursor++;Result rhs=factor(p);value.value*=rhs.value;p->operations++;space(p);
 }
 return value;
}
static Result expression(Parser *p){
 Result value=term(p);space(p);
 while(p->ok && (*p->cursor=='+'||*p->cursor=='-')){
  char op=*p->cursor++;Result rhs=term(p);
  value.value=(op=='+')?value.value+rhs.value:value.value-rhs.value;
  p->operations++;space(p);
 }
 return value;
}
int main(void){
 Parser p={"2*(3+4)-5+6*2",1,0};Result answer=expression(&p);
 printf("%ld %d %d %d\\n",answer.value,p.ok&&answer.ok,p.operations,*p.cursor==0);
 return 0;
}
`,'21 1 5 1\n',['Recursively parse expression: inner3+4=7,2*7=14,14-5=9,6*2=12,9+12=21.','Five source arithmetic reductions and six number tokens; cursor updates, result aggregates, strtol end pointer and short circuits interact.']);
add('34_short_input',`#include <stdio.h>
int main(void){
 int a=11,b=22;
 int count=scanf("%d %d",&a,&b);
 printf("%d %d %d\\n",count,a,b);
 char tail[4];int result=scanf("%3s",tail);
 if(result==1)printf("%s\\n",tail);
 return 0;
}
`,'1 7 22\nq\n',['Input7 q: first scanf assigns a7, stops at q, leaves b22, returns1.','Second scanf consumes q, writes q NUL, returns1. Do not synthesize failed second integer assignment.']);
added.at(-1).stdin='7 q\n';
add('35_pointer_selected_callback',`#include <stdio.h>
typedef int (*Operation)(int);
int inc(int n){return n+1;}
int square(int n){return n*n;}
Operation choose(int mode){return mode?square:inc;}
int main(void){
 int a=choose(0)(4);
 int b=choose(1)(a);
 printf("%d %d\\n",a,b);return 0;
}
`,'5 25\n',['Function pointer returns become indirect callees; choose0->inc4=5; choose1->square5=25.','Returned function identity and calleeInputs must link each actual call, no data dereference of code pointer.'],{calls:{choose:2,inc:1,square:1}});
for(const c of added){await fs.writeFile(new URL(c.id+'.c',import.meta.url),c.source);if(suite.cases.some(x=>x.id===c.id))throw Error('Duplicate');suite.cases.push(c);}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');console.log(added.map(c=>c.id).join(' '));
