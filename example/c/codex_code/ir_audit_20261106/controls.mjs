import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const added=[];
function add(id,source,stdout,process,checks={}){added.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('36_split_function_pointer',`#include <stdio.h>
typedef int (*Operation)(int);
int inc(int n){return n+1;}int square(int n){return n*n;}
Operation choose(int mode){return mode?square:inc;}
int main(void){Operation one=choose(0);int a=one(4);Operation two=choose(1);int b=two(a);printf("%d %d\\n",a,b);return 0;}
`,'5 25\n',['Control for nested factory-call binding: separate pointer variables keep call and return types distinct.'],{calls:{choose:2,inc:1,square:1}});
add('37_integer_update_forms',`#include <stdio.h>
int main(void){
 unsigned char a[1]={250};unsigned char *p=a;
 int x=(*p)++;
 int y=p[0]++;
 int z=++*p;
 *p+=1;
 printf("%d %d %d %u\\n",x,y,z,(unsigned)*p);return 0;
}
`,'250 251 253 254\n',['Same unsigned char storage updated through parenthesized dereference, subscript, prefix dereference, compound assignment.','Compare cType across actual WRITEs to same object; only source shape changes, signedness must not.']);
add('38_two_record_returns',`#include <stdio.h>
typedef struct {int x,y;} Item;
Item make(int n){
 Item first={n,n+1};Item second={9,10};
 if(n>0)return first;
 return second;
}
int main(void){Item a=make(4),b=make(0);printf("%d %d %d %d\\n",a.x,a.y,b.x,b.y);return 0;}
`,'4 5 9 10\n',['Control for source local alias lost through ABI sret reuse: two source locals and return sites.','Each call initializes first/second; first chosen4,5 then second9,10.'],{calls:{make:2}});
const unicode=suite.cases.find(c=>c.id==='32_unicode_positions');
add('39_unicode_comment_control',unicode.source.replaceAll('값','value').replaceAll('합계','total'),unicode.stdout,['Only identifiers changed to ASCII; Korean comment/string, emoji, tabs, CRLF retained.','Confirms whether failure comes from LLVM quoted identifiers, not Unicode source coordinate arithmetic.'],{calls:{twice:1}});
add('40_fixed_matrix_parameter',`#include <stdio.h>
int sum(int rows,int a[][3]){int result=0;for(int i=0;i<rows;i++)for(int j=0;j<3;j++)result+=a[i][j];return result;}
int main(void){int a[2][3]={{1,2,3},{4,5,6}};printf("%d\\n",sum(2,a));return 0;}
`,'21\n',['Control for runtime-width VLA argument: fixed-width row stride12.','Six reads and source sum total21, pointer-to-array parameter remains shallow.'],{calls:{sum:1}});
add('41_const_volatile',`#include <stdio.h>
int main(void){
 const int fixed=4;
 int a=fixed*2+1;
 volatile int state=0;
 int no=state||state;
 state=3;
 int yes=state&&state;
 printf("%d %d %d\\n",a,no,yes);return 0;
}
`,'9 0 1\n',['Two reads of state for || when0; two reads for && when3; volatile accesses cannot disappear.','const fixed is source object initialized4; compiler-folded fixed*2+1 retains source calculation result9.']);
add('42_sizeof_vla_effect',`#include <stdio.h>
int main(void){
 int n=2;
 int bytes=(int)sizeof(int[++n]);
 printf("%d %d\\n",n,bytes);return 0;
}
`,'3 12\n',['Runtime sizeof VLA type evaluates ++n to3 and calculates3*sizeof(int)=12.','No array object is allocated for this type-name sizeof expression; side effect cannot be marked unevaluated.']);
add('43_nested_factory_calls',`#include <stdio.h>
typedef int (*Operation)(int);
int inc(int x){return x+1;}int square(int x){return x*x;}
Operation choose(int n){return n?square:inc;}
int main(void){int result=choose(choose(0)(0))(3);printf("%d\\n",result);return 0;}
`,'9\n',['Actual order choose0 -> inc0 returns1 -> choose1 -> square3 returns9.','Different AST calls share start columns; instruction identity must follow actual callee SSA producer and full source node.']);
for(const c of added){await fs.writeFile(new URL(c.id+'.c',import.meta.url),c.source);if(suite.cases.some(x=>x.id===c.id))throw Error('Duplicate');suite.cases.push(c);}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');console.log(added.map(c=>c.id).join(' '));
