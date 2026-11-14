import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const added=[];
function add(id,source,stdout,process,checks={}){added.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('11_pointer_updates',`#include <stdio.h>
int main(void){
 int a[]={2,4,6},b[]={10,20,30};int *p=a,*q=b;
 *p++ += *q++;
 int old=(*p)++;
 *(++p)=*(++q)-old;
 printf("%d %d %d %d %ld %ld\\n",a[0],a[1],a[2],old,(long)(p-a),(long)(q-b));
 return 0;
}
`,'12 5 26 4 2 2\n',['First p/q advance but write targets a[0]=12. Postfix old gets4 while a[1] becomes5.','Prefix p/q reach element2 then write a[2]=30-4=26; pointer movement does not retarget earlier write.']);
add('12_float_bool',`#include <stdio.h>
#include <math.h>
int main(void){
 double x=-0.5,y=2.25;
 _Bool b=x;int z=(int)x;float f=(float)(x+y*2);
 double whole=0;double part=modf(y,&whole);
 int exponent=0;double mantissa=frexp(8.0,&exponent);
 printf("%d %d %.2f %.2f %.0f %.2f %d\\n",b,z,(double)f,part,whole,mantissa,exponent);
 return 0;
}
`,'1 0 4.00 0.25 2 0.50 4\n',['double -0.5 -> bool1, int0; source arithmetic x+y*2 produces4.','modf writes whole2 and returns.25; frexp writes exponent4 and returns.5; side effects represented.'],{calls:{modf:1,frexp:1}});
add('13_search_callback',`#include <stdio.h>
#include <stdlib.h>
int comparisons=0;
int cmp(const void *x,const void *y){
 comparisons++;
 int a=*(const int*)x,b=*(const int*)y;
 return (a>b)-(a<b);
}
int main(void){
 int values[]={2,5,8,11,14};int key=11;
 int *p=bsearch(&key,values,5,sizeof values[0],cmp);
 printf("%d %ld %d\\n",*p,(long)(p-values),comparisons>0);
 return 0;
}
`,'11 3 1\n',['External bsearch invokes actual user comparator calls; their number may vary by libc and is not fixed by oracle.','Comparator reads int key/array cells; result points to values[3], shared global comparisons updates survive.'],{calls:{bsearch:1}});
add('14_strtok_alias',`#include <stdio.h>
#include <string.h>
int main(void){
 char s[]="ab,cd,ef";
 char *first=strtok(s,",");char *second=strtok(NULL,",");char *third=strtok(NULL,",");
 printf("%s %s %s %d %d\\n",first,second,third,s[2],s[5]);
 return 0;
}
`,'ab cd ef 0 0\n',['strtok overwrites commas at2 and5 with NUL; third token already terminated.','All three returned pointers refer to original s offsets0,3,6; NULL argument continues library state.'],{calls:{strtok:3}});
add('15_realloc_alias',`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
 int *p=malloc(3*sizeof *p);if(!p)return 1;
 p[0]=3;p[1]=6;p[2]=9;
 int *q=realloc(p,6*sizeof *q);if(!q){free(p);return 1;}p=q;
 for(int i=3;i<6;i++)p[i]=p[i-3]+10;
 int copy[6];memcpy(copy,p,6*sizeof *p);free(p);p=NULL;
 int total=0;for(int i=0;i<6;i++)total+=copy[i];
 printf("%d %d\\n",total,p==NULL);return 0;
}
`,'66 1\n',['Resize retains3,6,9; newly initialized tail13,16,19; copy independent, survives free.','Realloc may move; reference identity must follow observed lifetime, not assumed identical address.'],{calls:{malloc:1,realloc:1,memcpy:1,free:1}});
add('16_macro_effects',`#include <stdio.h>
int calls=0;
int get(int n){calls++;return n;}
#define PICK(a,b) ((a)>(b)?(a):(b))
#define CHANGE(x,y) do {int temporary=(x);(x)=(y);(y)=temporary;}while(0)
int main(void){
 int a=3,b=8;
 int chosen=PICK(get(a),get(b));
 CHANGE(a,b);
 printf("%d %d %d %d\\n",chosen,a,b,calls);
 return 0;
}
`,'8 8 3 3\n',['Macro PICK compares get(3),get(8) then repeats only get(8); exact evaluation order of comparison operands not asserted.','CHANGE creates lexical temp3 then writes a8,b3; no invented function frame for macro.'],{calls:{get:3}});
add('17_scope_reentry',`#include <stdio.h>
int main(void){
 int sum=0,iteration=0;
again:
 {
  int value=iteration+2;
  sum+=value;
  iteration++;
  if(iteration<3)goto again;
 }
 {int sum=40;printf("%d ",sum);}
 printf("%d\\n",sum);return 0;
}
`,'40 9\n',['goto reenters lexical block three times, distinct value lifetimes2,3,4.','Shadowed sum40 separate object from outer sum9; goto should close departing block before reopening.']);
add('18_union_bitfields',`#include <stdio.h>
#include <string.h>
typedef struct {unsigned a:3;unsigned b:5;} Flags;
typedef union {Flags flags;unsigned char bytes[sizeof(Flags)];} Data;
int main(void){
 Data x={0};x.flags.a=3;x.flags.b=17;
 Data y;memcpy(&y,&x,sizeof x);
 unsigned old=y.flags.a++;y.flags.b^=3;
 printf("%u %u %u %u\\n",old,y.flags.a,y.flags.b,x.flags.b);
 return 0;
}
`,'3 4 18 17\n',['Complete memcpy retains active initialized bitfields; increment is modulo unsigned 3-bit field, here3->4.','Other field xor17^3=18, original x remains3,17; do not read nonactive bytes as semantic fields.']);
add('19_vla_pointer_parameter',`#include <stdio.h>
int sum(int rows,int cols,int a[rows][cols]){
 int result=0;
 for(int i=0;i<rows;i++)for(int j=0;j<cols;j++)result+=a[i][j];
 return result;
}
int main(void){int a[2][3]={{1,2,3},{4,5,6}};printf("%d\\n",sum(2,3,a));return 0;}
`,'21\n',['Array parameter is pointer to row with runtime stride cols*4=12.','Read six original cells in row-major order and accumulate1,3,6,10,15,21; no array parameter deep copy.'],{calls:{sum:1}});
add('20_varargs_ints',`#include <stdio.h>
#include <stdarg.h>
int sum(int n,...){va_list ap;va_start(ap,n);int total=0;for(int i=0;i<n;i++)total+=va_arg(ap,int);va_end(ap);return total;}
int main(void){printf("%d\\n",sum(3,4,5,6));return 0;}
`,'15\n',['Minimal integer-only variadic control for mixed double case; reads4,5,6.'],{calls:{sum:1}});
for(const c of added){await fs.writeFile(new URL(c.id+'.c',import.meta.url),c.source);if(suite.cases.some(x=>x.id===c.id))throw Error('Duplicate case');suite.cases.push(c);}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');
console.log(added.map(c=>c.id).join(' '));
