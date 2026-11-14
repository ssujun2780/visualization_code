import fs from 'node:fs/promises';import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8')),added=[];
function add(id,title,body,stdout,process,checks={},stdin=''){if(manifest.cases.some(c=>c.id===id))throw Error('Already exists');const source='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('37_buffered_output','Small output operations flushed only at the end',String.raw`
int main(void){setvbuf(stdout,NULL,_IOFBF,4096);for(int i=1;i<=3;i++){printf("[%d]",i);fputs(".",stdout);}putchar('\n');fflush(stdout);return 0;}`,
 '[1].[2].[3].\n',['Source output belongs to each printing call even if actual WASI write occurs at fflush.','Calls should not multiply terminal output by treating buffer copies as new output.'],{});
add('38_scan_suppression','Parse the same string with suppression and percent-n',String.raw`
int main(void){char s[]="12 34",out[32];int a=0,b=0,n=0;sscanf(s,"%d %d%n",&a,&b,&n);int redundant=0;sscanf(s,"%*d %d",&redundant);snprintf(out,sizeof out,"%03d:%d:%d",a,b,n);printf("%s %d\n",out,redundant);return 0;}`,
 '012:34:5 34\n',['sscanf records writes a=12 b=34 n=5; suppressed input does not consume a destination.','snprintf writes out and printf emits that buffer exactly once.'],{calls:{sscanf:2,snprintf:1}});
add('39_pushback_input','Read every character twice using one-character pushback',String.raw`
int main(void){int count=0,total=0,c;while((c=getchar())!='\n'){if(c==EOF)break;ungetc(c,stdin);int again=getchar();count++;total+=again-'0';}printf("%d %d\n",count,total);return 0;}`,
 '4 10\n',['Each digit has two library getchar calls but only one external input byte.','ungetc restores stream data; final newline terminates the bounded input.'],{calls:{getchar:9,ungetc:4}},'1234\n');
add('40_flexible_buffer','Flexible array rebuilt through unnecessary clone',String.raw`
typedef struct{int n;int values[];} Buffer;
Buffer* make(int n){Buffer*p=malloc(sizeof *p+(size_t)n*sizeof p->values[0]);if(!p)return NULL;p->n=n;for(int i=0;i<n;i++)p->values[i]=i+1;return p;}
int main(void){Buffer*a=make(4);if(!a)return 1;size_t bytes=sizeof *a+(size_t)a->n*sizeof a->values[0];Buffer*b=malloc(bytes);if(!b){free(a);return 1;}memcpy(b,a,bytes);b->values[2]+=7;int sum=0;for(int i=0;i<b->n;i++)sum+=b->values[i];printf("%d %d\n",a->values[2],sum);free(a);free(b);return 0;}`,
 '3 17\n',['Both 20-byte allocations include a flexible tail; memcpy covers header and values.','Pointer member-access extent is based on observed allocation, not fixed sizeof(Buffer) alone.'],{heapObjects:2,allHeapEnded:true,calls:{memcpy:1}});
add('41_nested_designated','Repeated assignments to nested designated records',String.raw`
typedef struct{int x,y;} Point;typedef struct{Point p[2];int tag;} Shape;
int main(void){Shape s={.p={{.y=2,.x=1},{.x=3,.y=4}},.tag=7};int total=0;for(int i=0;i<3;i++){Shape copy=s;copy.p[i%2].x+=i;s=copy;total+=s.p[0].x+s.p[1].x;}printf("%d %d %d\n",s.p[0].x,s.p[1].x,total);return 0;}`,
 '3 4 16\n',['Three complete record copies in each direction; nested changed element respects its byte offset.','Final x coordinates 3 and 4; totals 4,5,7.'],{objectCounts:{copy:3}});
add('42_matrix_transpose','Two full transposes with deliberately redundant copies',String.raw`
void transpose(int a[3][3],int b[3][3]){for(int i=0;i<3;i++)for(int j=0;j<3;j++){int temporary=a[i][j];b[j][i]=temporary;}}
int main(void){int a[3][3]={{1,2,3},{4,5,6},{7,8,9}},b[3][3],c[3][3];transpose(a,b);transpose(b,c);int total=0;for(int i=0;i<3;i++)for(int j=0;j<3;j++)total+=c[i][j];printf("%d %d %d\n",c[0][2],c[2][0],total);return 0;}`,
 '3 7 45\n',['18 temporary scalar lifetimes copy each matrix element twice.','Array-of-array pointer parameters retain row stride and element read targets.'],{calls:{transpose:2},objectCounts:{temporary:18}});
add('43_mixed_varargs','Mixed argument types read twice with va_copy',String.raw`
#include <stdarg.h>
double combine(int tag,...){va_list a,b;va_start(a,tag);va_copy(b,a);int x=va_arg(a,int);double y=va_arg(a,double);unsigned long long z=va_arg(a,unsigned long long);int xx=va_arg(b,int);double yy=va_arg(b,double);unsigned long long zz=va_arg(b,unsigned long long);va_end(a);va_end(b);return x+y+(double)z+xx+yy+(double)zz;}
int main(void){double x=combine(0,-3,2.5,9ULL);printf("%.1f\n",x);return 0;}`,
 '17.0\n',['Both cursors yield int -3, double 2.5, unsigned long long 9.','Different argument alignment and signedness must survive each read.'],{calls:{combine:1}});
add('44_redundant_float','Repeated floating conversions with exact binary fractions',String.raw`
int main(void){double a[3]={1.5,2.25,3.75},total=0;for(int i=0;i<3;i++){float copy=(float)a[i];double again=(double)copy;int whole=(int)again;double remainder=again-whole;total+=whole+remainder;}printf("%.2f\n",total);return 0;}`,
 '7.50\n',['Every value roundtrips double to float to double, then splits integer and fractional parts.','Exact selected values prevent floating comparison/printing ambiguity.'],{});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(`Saved ${added.length} predictions before execution.`);
