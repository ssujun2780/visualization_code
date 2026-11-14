import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const cases=[];
function add(id,source,stdout,process,checks={}){cases.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('01_comma_conditional',`#include <stdio.h>
int calls=0;
int next(int x){ calls++; return x+1; }
int main(void){
 int x=2,y=9;
 int a=(x+=3,x*2); // @write:a
 int b=x<y ? next(x) : next(y); // @write:b
 int c=(x>y && next(40)) || (y>x && next(0)); // @write:c
 int d=(x==5 ? (y+=2,y) : (x+=4,x))+a; // @write:d
 printf("%d %d %d %d %d %d %d\\n",x,y,a,b,c,d,calls);
 return 0;
}
`,'5 11 10 6 1 21 2\n',['Comma writes x before reading x*2; only selected ternary arm executes.','Short circuit skips next(40), executes next(0); calls total 2.','a=10,b=6,c=1,d=21, no source-level comma arithmetic.'],{writes:{a:['10'],b:['6'],c:['1']},calls:{next:2}});
add('02_nested_return',`#include <stdio.h>
typedef struct {int a[2];int *p;} Pair;
Pair make(int *p,int n){ Pair r={{n,n+1},p};return r; }
Pair alter(Pair r){r.a[1]+=*r.p;*r.p+=2;return r;}
int main(void){
 int base=5;
 Pair r=alter(make(&base,3));
 int sum=r.a[0]+r.a[1]+*r.p; // @write:sum
 printf("%d %d %d %d\\n",r.a[0],r.a[1],base,sum);
 return 0;
}
`,'3 9 7 19\n',['make returns independent aggregate {3,4,&base}; alter by value changes a[1] to9 and shared base to7.','Two aggregate parameter/return transfers, selected fields remain distinct; sum one source CALC.'],{writes:{sum:['19']},calls:{make:1,alter:1}});
add('03_varargs',`#include <stdio.h>
#include <stdarg.h>
double weighted(int count,...){
 va_list ap;va_start(ap,count);
 double total=0;
 for(int i=0;i<count;i++){
  int weight=va_arg(ap,int);
  double value=va_arg(ap,double);
  total+=weight*value; // @write:total
 }
 va_end(ap);return total;
}
int main(void){double result=weighted(3,2,1.5,3,2.0,-1,0.5);printf("%.1f\\n",result);return 0;}
`,'8.5\n',['User variadic function reads alternating int,double values: (2,1.5),(3,2),(-1,0.5).','total goes 0->3->9->8.5; variadic memory is initialized argument data, not garbage.'],{calls:{weighted:1}});
add('04_vla_sizeof',`#include <stdio.h>
int visits=0;
int size(void){visits++;return 3;}
int main(void){
 int n=size();
 int a[n][2];
 for(int i=0;i<n;i++){a[i][0]=i+1;a[i][1]=2*(i+1);}
 int bytes=(int)sizeof a;
 int total=0;
 for(int i=0;i<n;i++) total+=a[i][0]+a[i][1]; // @write:total
 printf("%d %d %d\\n",bytes,total,visits);
 return 0;
}
`,'24 18 1\n',['One 24-byte VLA created after n=3. sizeof does not call size again.','Six distinct element writes; total cumulative 3,9,18. VLA ends before frame.'],{writes:{total:['3','9','18']},calls:{size:1}});
add('05_flexible_bytes',`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {int n;unsigned char data[];} Packet;
int main(void){
 Packet *p=malloc(sizeof *p+4*sizeof p->data[0]);if(!p)return 1;
 p->n=4;
 for(int i=0;i<p->n;i++)p->data[i]=(unsigned char)(10+i);
 unsigned char copy[4];memcpy(copy,p->data,4);
 int total=0;for(int i=0;i<4;i++)total+=copy[i];
 printf("%d %u %u %d\\n",p->n,(unsigned)copy[0],(unsigned)copy[3],total);
 free(p);return 0;
}
`,'4 10 13 46\n',['8-byte allocation: n at offset0 and flexible data bytes at offsets4..7.','memcpy transfers four initialized bytes; flexible member bounds governed by allocation.'],{calls:{malloc:1,memcpy:1,free:1}});
add('06_library_end_pointer',`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
 char source[]="12,-7,30";char *p=source,*end;
 long sum=0;
 while(*p){long v=strtol(p,&end,10);sum+=v;if(*end==0)break;p=end+1;}
 char out[32];int length=snprintf(out,sizeof out,"sum=%ld",sum);
 char *found=strchr(out,'=');
 printf("%s %d %c\\n",out,length,found[1]);return 0;
}
`,'sum=35 6 3\n',['strtol outputs 12,-7,30 and writes end pointer after each consumed number.','snprintf writes sum=35 plus NUL into out; length6; strchr points at out[3].'],{calls:{strtol:3,snprintf:1,strchr:1}});
add('07_overlap_memmove',`#include <stdio.h>
#include <string.h>
int main(void){
 char s[16]="abcdef";
 char *p=s+1;
 memmove(p+1,p,5);
 s[1]='X';
 char *tail=memchr(s,'d',7);
 printf("%s %ld\\n",s,(long)(tail-s));
 return 0;
}
`,'aXbcdef 5\n',['Overlap memmove reads original b,c,d,e,f into offsets2..6; original NUL at6 is overwritten.','NOTE source must move terminating NUL too; fixture corrected before execution below.']);
// Include the terminator: 6 bytes at offsets1..6 -> offsets2..7.
cases.at(-1).source=cases.at(-1).source.replace('memmove(p+1,p,5)','memmove(p+1,p,6)');
cases.at(-1).process=['Overlapping copy reads original b,c,d,e,f,NUL and writes offsets2..7.','s becomes aXbcdef; memchr returns s+5; one copy with correct pre-copy snapshot.'];
add('08_static_recursion',`#include <stdio.h>
int sum=0;
int visit(int n){
 static int calls=0;calls++;
 int local=n;
 if(n>0)local+=visit(n-1);
 sum+=local;
 return local;
}
int main(void){int a=visit(3);int b=visit(1);printf("%d %d %d\\n",a,b,sum);return 0;}
`,'6 1 11\n',['Six visit frames, local values n, recursive returns0,1,3,6 then0,1.','One static calls object incremented six times; global sum ends11; static storage persists across returns.'],{calls:{visit:6}});
add('09_function_pointer_array',`#include <stdio.h>
int add(int a,int b){return a+b;}
int sub(int a,int b){return a-b;}
int mul(int a,int b){return a*b;}
int main(void){
 int (*ops[3])(int,int)={add,sub,mul};
 int total=0;
 for(int i=0;i<3;i++){int result=ops[i](7,i+2);total+=result;}
 printf("%d\\n",total);return 0;
}
`,'41\n',['Indirect calls resolve to add(7,2)=9, sub(7,3)=4,mul(7,4)=28; total41.','CALC/call targets must not conflate function pointer index with argument arithmetic.'],{calls:{add:1,sub:1,mul:1}});
add('10_input_output',`#include <stdio.h>
#include <string.h>
int main(void){
 char buffer[16];
 if(!fgets(buffer,sizeof buffer,stdin))return 1;
 int a=0,b=0,used=0;
 int count=sscanf(buffer,"%d,%d%n",&a,&b,&used);
 char out[32];int len=snprintf(out,sizeof out,"%d:%d:%d",a+b,count,used);
 fwrite(out,1,(size_t)len,stdout);putchar('\n');
 fprintf(stderr,"ok\\n");return 0;
}
`.replace("putchar('\n')","putchar('\\n')"),'19:2:5\n',['fgets writes 12,7! newline NUL; sscanf assigns a12,b7,used4,returns2.','snprintf length6; fwrite stdout string; putchar newline; fprintf stderr distinct stream.']);
// %n reports four consumed bytes in 12,7!, not five. Pre-run oracle correction.
cases.at(-1).stdout='19:2:4\n';cases.at(-1).stdin='12,7!\n';cases.at(-1).stderr='ok\n';
for(const c of cases){c.sha256=crypto.createHash('sha256').update(c.source).digest('hex');c.createdAt=new Date().toISOString();await fs.writeFile(new URL(`${c.id}.c`,import.meta.url),c.source);}
await fs.writeFile(new URL('cases.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),cases},null,2)+'\n');
console.log(`Wrote ${cases.length} sources and predictions before execution.`);
