import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const added=[];
function add(id,source,stdout,process,checks={}){added.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('21_unsigned_indirect_update',`#include <stdio.h>
int main(void){
 unsigned char data[2]={250,0};unsigned char *p=data;
 int before=(*p)++;
 int after=--p[1];
 printf("%d %u %d %u\\n",before,(unsigned)data[0],after,(unsigned)data[1]);
 return 0;
}
`,'250 251 255 255\n',['Promote unsigned char for arithmetic, convert stored values to unsigned8; postfix passes250, prefix passes255.','Final writes need unsigned C type, not only raw i8 signed/unsigned strings.']);
add('22_named_record_return',`#include <stdio.h>
typedef struct {int x,y;} Item;
Item make(int n){
 Item local={n,n+1};
 local.y+=2;
 return local;
}
int main(void){Item result=make(4);printf("%d %d\\n",result.x,result.y);return 0;}
`,'4 7\n',['Source local object belongs to make frame and initializes before local.y+=2.','ABI return-slot reuse may share physical storage but cannot erase the source local identity or time its creation before function call.'],{calls:{make:1}});
add('23_record_call_value',`#include <stdio.h>
typedef struct {int a,b;} Item;
Item build(int n){Item x={n,n+2};return x;}
int use(Item x){return x.a+x.b;}
int main(void){int total=use(build(4));printf("%d\\n",total);return 0;}
`,'10\n',['Nested by-value argument snapshot is {4,6}; call use consumes build return value.','Provenance should reach return or initialized bytes, not just uninitialized storage-creation event.'],{calls:{build:1,use:1}});
add('24_variadic_forward',`#include <stdio.h>
#include <stdarg.h>
int emit(const char *format,...){
 va_list ap;va_start(ap,format);
 int n=vprintf(format,ap);
 va_end(ap);return n;
}
int main(void){int n=emit("%d %.1f\\n",7,2.5);printf("len=%d\\n",n);return 0;}
`,'7 2.5\nlen=6\n',['User va_list forwarded into external vprintf must remain live argument memory.','Output occurs inside vprintf nested in emit; emit returns6 before outer printf.'],{calls:{emit:1,vprintf:1}});
add('25_conditional_lvalue',`#include <stdio.h>
typedef struct {int value;} Box;
int main(void){
 Box a={3},b={8};Box *p=&a,*q=&b;
 int choose=0;
 (choose?p:q)->value+=4;
 int old=((choose?*p:*q).value);
 choose=1;
 (choose?p:q)->value=old-2;
 printf("%d %d %d\\n",a.value,b.value,old);return 0;
}
`,'10 12 12\n',['First selection targets b for update12; aggregate selection copies chosen Box value for read, old12.','After choose1, assignment targets a10; no WRITE to unselected object.']);
add('26_vla_one_dimension',`#include <stdio.h>
int main(void){int n=3;int a[n];for(int i=0;i<n;i++)a[i]=i+1;printf("%d %d\\n",a[2],(int)sizeof a);return 0;}
`,'3 12\n',['Control for multidimensional VLA: one allocation12 bytes, three initialized cells, correct runtime sizeof.']);
add('27_scalar_aggregate_init',`#include <stdio.h>
int count=0;int step(void){return ++count;}
typedef struct {int a,b;int values[3];} Packet;
int main(void){
 Packet p={.b=9,.a=step(),.values={[1]=step()}};
 printf("%d %d %d %d %d %d\\n",p.a,p.b,p.values[0],p.values[1],p.values[2],count);
 return 0;
}
`,'1 9 0 2 0 2\n',['Two source initializer calls observed; omitted fields implicitly zero-filled.','Portable code leaves ordering of separate initializer expressions unspecified, so if native order differs this fixture needs review, not a model fault.'],{calls:{step:2}});
add('28_output_binary',`#include <stdio.h>
int main(void){unsigned char data[4]={'A',0,'B','\n'};fwrite(data,1,4,stdout);fputs("end",stdout);fputc('\n',stdout);return 0;}
`.replace("'\n'","'\\n'").replace("fputc('\n'","fputc('\\n'"),'A\0B\nend\n',['Output bytes include embedded NUL and newline; preserve byteLength and order across fwrite,fputs,fputc.']);
for(const c of added){await fs.writeFile(new URL(c.id+'.c',import.meta.url),c.source);if(suite.cases.some(x=>x.id===c.id))throw Error('Duplicate');suite.cases.push(c);}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');console.log(added.map(c=>c.id).join(' '));
