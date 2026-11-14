import fs from 'node:fs/promises';import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8')),added=[];
function add(id,title,body,stdout,process,checks={},stdin=''){if(manifest.cases.some(c=>c.id===id))throw Error('Already exists');const source='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('25_runtime_strlen','Runtime-input counterpart of repeated string growth',String.raw`
int main(void){char text[8];if(scanf("%7s",text)!=1)return 1;char*p=malloc(1);if(!p)return 1;p[0]=0;
for(int i=0;i<(int)strlen(text);i++){size_t n=strlen(p);char*q=realloc(p,n+2);if(!q){free(p);return 1;}p=q;char one[2]={text[i],0};strcat(p,one);}printf("%s %d\n",p,(int)strlen(p));free(p);return 0;}`,
 'banana 6\n',['Same redundant work as case 04, but condition input is obtained at runtime.','All 14 strlen calls should have runtime call evidence.'],{calls:{strlen:14,realloc:6},heapObjects:7,allHeapEnded:true},'banana\n');
add('26_folded_library','Pure builtin work and actual side-effect calls',String.raw`
int ticks=0;int touch(void){ticks++;return 3;}
int main(void){int total=0;for(int i=0;i<4;i++){int n=(int)strlen("abc")+abs(-4);int same=strcmp("aa","aa");total+=n+same+touch();}printf("%d %d\n",total,ticks);return 0;}`,
 '40 4\n',['Source pure builtin expressions may be folded; observed constant plus source AST must identify their meaning.','touch is never substituted: four actual calls and writes.'],{calls:{touch:4}});
add('27_parallel_indices','Three independent postincrements in one expression',String.raw`
int main(void){int a[3]={1,2,3},b[3]={4,5,6},out[3]={0},i=0,j=0,k=0;while(i<3){out[j++]=a[i++]+b[k++]*2;}printf("%d %d %d | %d %d %d\n",out[0],out[1],out[2],i,j,k);return 0;}`,
 '9 12 15 | 3 3 3\n',['Each postfix uses its old index; three distinct index objects have no unsequenced conflict.','Compiler-chosen valid evaluation order may differ, but out receives 9,12,15.'],{writes:[{object:'i',values:['0','1','2','3']},{object:'j',values:['0','1','2','3']},{object:'k',values:['0','1','2','3']}]} );
add('28_comma_steps','Comma sequencing and redundant increment/decrement',String.raw`
int main(void){int i=0,x=0,total=0;for(int pass=0;pass<3;pass++){x=(i++,i*3);total+=(x+=2,x);i++;i--;}printf("%d %d %d\n",i,x,total);return 0;}`,
 '3 11 24\n',['Comma sequences increment before multiplication and x+=2 before consumption.','Redundant i++/i-- remains recorded.'],{writes:[{object:'i',values:['0','1','2','1','2','3','2','3','4','3']},{object:'x',values:['0','3','5','6','8','9','11']}]} );
add('29_branch_struct','Conditional aggregate returns with repeated copies',String.raw`
typedef struct{int a,b;} Pair;
Pair make(int x){Pair p={x,x+1};Pair copy=p;return copy;}
int main(void){int total=0;for(int i=0;i<4;i++){Pair p=(i%2)?make(i):make(i+2);Pair q=p;total+=q.a+q.b;}printf("%d\n",total);return 0;}`,
 '24\n',['Only selected make branch runs, four invocations total.','Aggregate result feeds p, then copy into q, before field reads.'],{calls:{make:4}});
add('30_compound_records','Compound literal copied repeatedly into a wrapper',String.raw`
typedef struct{int x,y;} Point;
int measure(Point p){Point copy=p;return copy.x*copy.x+copy.y*copy.y;}
int main(void){int total=0;for(int i=0;i<4;i++){total+=measure((Point){i,1});total+=measure((Point){i,1});}printf("%d\n",total);return 0;}`,
 '36\n',['Eight measure frames and eight compound-literal evaluations.','Source temporary lifetimes and by-value argument origins remain distinct.'],{calls:{measure:8}});
add('31_naive_decimal','Convert decimal text through repeated power loops',String.raw`
int power10(int n){int p=1;for(int i=0;i<n;i++)p*=10;return p;}
int main(void){char s[6]="12034";int n=(int)strlen(s),answer=0;for(int i=0;i<n;i++){int digit=s[i]-'0';answer+=digit*power10(n-1-i);}printf("%d\n",answer);return 0;}`,
 '12034\n',['Five power10 calls; ten redundant multiply steps in total.','Each char-to-int promotion and subtraction remains attached to digit expression.'],{calls:{power10:5},calcCounts:[{expression:'p*=10',count:10}]} );
add('32_merge_allocations','Recursive merge sort allocating at every merge',String.raw`
void sort(int*a,int n){if(n<2)return;int m=n/2;sort(a,m);sort(a+m,n-m);int*t=malloc((size_t)n*sizeof *t);if(!t)exit(1);int i=0,j=m,k=0;while(i<m&&j<n){if(a[i]<a[j])t[k++]=a[i++];else t[k++]=a[j++];}while(i<m)t[k++]=a[i++];while(j<n)t[k++]=a[j++];for(i=0;i<n;i++)a[i]=t[i];free(t);}
int main(void){int a[6]={6,2,5,1,4,3};sort(a,6);for(int i=0;i<6;i++)printf("%d ",a[i]);puts("");return 0;}`,
 '1 2 3 4 5 6 \n',['Eleven recursion frames, five temporary heap allocations.','Parent regions stay live while recursive views share portions of original array.'],{calls:{sort:11,malloc:5,free:5},heapObjects:5,allHeapEnded:true});
add('33_recompute_dp','Rebuild a complete Fibonacci table for every prefix',String.raw`
int main(void){int total=0;for(int n=1;n<=8;n++){int*t=calloc((size_t)n+1,sizeof *t);if(!t)return 1;t[1]=1;for(int j=2;j<=n;j++)t[j]=t[j-1]+t[j-2];total+=t[n];free(t);}printf("%d\n",total);return 0;}`,
 '54\n',['Eight allocations, repeated earlier-prefix work is retained.','28 table recurrence evaluations produce 54 total.'],{calls:{calloc:8,free:8},heapObjects:8,allHeapEnded:true,calcCounts:[{expression:'t[j-1]+t[j-2]',count:28}]} );
add('34_matrix_dijkstra','Repeated full matrix scans with redundant minimum lookup',String.raw`
int main(void){int g[5][5]={{0,2,7,99,99},{99,0,1,4,99},{99,99,0,1,7},{99,99,99,0,3},{99,99,99,99,0}},d[5]={0,99,99,99,99},used[5]={0};
for(int step=0;step<5;step++){int u=-1;for(int v=0;v<5;v++)if(!used[v]&&(u<0||d[v]<d[u]))u=v;int again=-1;for(int v=0;v<5;v++)if(!used[v]&&(again<0||d[v]<d[again]))again=v;u=again;used[u]=1;for(int v=0;v<5;v++)if(!used[v]&&g[u][v]<99&&d[u]+g[u][v]<d[v])d[v]=d[u]+g[u][v];}
for(int v=0;v<5;v++)printf("%d ",d[v]);puts("");return 0;}`,
 '0 2 3 4 7 \n',['Two complete minimum scans each round; second duplicates first.','u<0 guards d[u]; all accesses are valid and all nodes reachable.'],{});
add('35_bitfield_counter','Needlessly update packed fields and restore them',String.raw`
typedef struct{unsigned a:3;unsigned b:5;} Flags;
int main(void){Flags f={1,3};int total=0;for(int i=0;i<4;i++){f.a+=1;f.b+=2;total+=f.a+f.b;f.b-=1;}printf("%u %u %d\n",f.a,f.b,total);return 0;}`,
 '5 7 40\n',['Field arithmetic uses promoted integer types; values fit all fields.','Changes to a do not alter b and vice versa; final a=5 b=7.'],{});
add('36_redundant_variadic','Variadic helper copies argument list then reads both',String.raw`
#include <stdarg.h>
int sumtwice(int n,...){va_list a,b;va_start(a,n);va_copy(b,a);int x=0,y=0;for(int i=0;i<n;i++)x+=va_arg(a,int);for(int i=0;i<n;i++)y+=va_arg(b,int);va_end(a);va_end(b);return x+y;}
int main(void){int a=sumtwice(4,1,2,3,4),b=sumtwice(3,5,6,7);printf("%d %d\n",a,b);return 0;}`,
 '20 36\n',['va_copy duplicates cursor state; both loops read original payloads.','Each argument consumed twice; two invocations remain distinct.'],{calls:{sumtwice:2}});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(`Saved ${added.length} predictions before execution.`);
