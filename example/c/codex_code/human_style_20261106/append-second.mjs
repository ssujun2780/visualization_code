import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8'));
const added=[],headers='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n';
function add(id,title,body,stdout,process,checks={},stdin=''){
 if(manifest.cases.some(c=>c.id===id))throw Error('Already exists: '+id);
 const source=headers+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});
}
add('13_subtract_gcd','Repeated subtraction and redundant calls',String.raw`
int gcd(int a,int b){while(a!=b){if(a>b)a-=b;else b-=a;}return a;}
int main(void){int a[3]={18,35,48},b[3]={12,15,18},sum=0;for(int i=0;i<3;i++){int first=gcd(a[i],b[i]);int second=gcd(a[i],b[i]);sum+=first+second;}printf("%d\n",sum);return 0;}`,
 '34\n',['Six gcd calls; each pair repeats identical subtraction work.','Compound assignments consume current destination and selected other operand.'],{calls:{gcd:6}});
add('14_queue_memmove','Shift an entire queue on every pop',String.raw`
int main(void){int q[8]={0},n=0,total=0;for(int i=1;i<=5;i++){q[n]=i*3;n++;}while(n>0){int x=q[0];memmove(q,q+1,(size_t)(n-1)*sizeof *q);n--;total+=x;}printf("%d %d\n",total,n);return 0;}`,
 '45 0\n',['Five memmove calls including final zero-byte operation.','Overlapping copy reads original bytes; no fabricated element-by-element destructive overwrite.'],{calls:{memmove:5}});
add('15_deep_shallow','Redundant deep copies and an explicit shallow alias',String.raw`
typedef struct{int *v;int n;} Box;
Box duplicate(Box a){Box b;b.n=a.n;b.v=malloc((size_t)b.n*sizeof *b.v);if(b.v)memcpy(b.v,a.v,(size_t)b.n*sizeof *b.v);return b;}
int main(void){int data[3]={2,4,6};Box a={data,3},b=duplicate(a);if(!b.v)return 1;Box alias=b;Box c=duplicate(b);if(!c.v){free(b.v);return 1;}alias.v[1]=9;c.v[2]=8;printf("%d %d %d %d\n",a.v[1],b.v[1],c.v[1],c.v[2]);free(b.v);free(c.v);return 0;}`,
 '4 9 4 8\n',['Value-copied Box aliases the same pointee; memcpy duplicates only pointed integers.','alias.v changes b storage, not a or c.'],{calls:{duplicate:2,memcpy:2},heapObjects:2,allHeapEnded:true});
add('16_prefix_rescan','Build prefixes then repeatedly measure and format them',String.raw`
int main(void){char text[6]="abcde",prefix[6]={0},line[32];int total=0;for(int i=0;i<5;i++){memcpy(prefix,text,(size_t)i+1);prefix[i+1]=0;int n=(int)strlen(prefix);total+=n;snprintf(line,sizeof line,"%s:%d",prefix,n);puts(line);}printf("%d\n",total);return 0;}`,
 'a:1\nab:2\nabc:3\nabcd:4\nabcde:5\n15\n',['Five prefix copies, five strlen and snprintf calls followed by visible puts output.','snprintf writes local string, puts reads it; no terminal output for snprintf.'],{calls:{memcpy:5,strlen:5,snprintf:5,puts:5}});
add('17_shadow_scopes','Nested shadow variables recreated for every iteration',String.raw`
int main(void){int x=100,total=0;for(int i=0;i<3;i++){int x=i+1;{int x=2;total+=x;}total+=x;}printf("%d %d\n",x,total);return 0;}`,
 '100 12\n',['Seven distinct x lifetimes: outer one, loop-body three, inner three.','Inner scope cleanup does not end outer x.'],{objectCounts:{x:7}});
add('18_vla_rows','VLA dimensions through redundant row copies',String.raw`
int row_sum(int n,int row[n]){int scratch[n];for(int i=0;i<n;i++)scratch[i]=row[i];int total=0;for(int i=0;i<n;i++)total+=scratch[i];return total;}
int main(void){int n=3,a[n][n];for(int i=0;i<n;i++)for(int j=0;j<n;j++)a[i][j]=i*n+j+1;int total=0;for(int i=0;i<n;i++)total+=row_sum(n,a[i]);printf("%d %d\n",total,(int)(sizeof a/sizeof a[0][0]));return 0;}`,
 '45 9\n',['Three scratch VLAs each hold exactly three ints and end on return.','Row address bookkeeping remains separate from scalar element calculations.'],{calls:{row_sum:3},objectCounts:{scratch:3}});
add('19_macro_redundancy','Statement macro repeated inside unused-work loops',String.raw`
#define SWAP(a,b) do{int temporary=(a);(a)=(b);(b)=temporary;}while(0)
#define STEP(x) ((x)*2+1)
int main(void){int a[3]={1,2,3};for(int i=0;i<4;i++){SWAP(a[0],a[2]);SWAP(a[0],a[2]);}int sum=0;for(int i=0;i<3;i++)sum+=STEP(a[i]);printf("%d %d %d %d\n",a[0],a[1],a[2],sum);return 0;}`,
 '1 2 3 15\n',['Eight actual swaps despite net identity; each macro-local temporary is a separate lifetime.','STEP arithmetic is grouped by source macro expansion, not attached to unrelated operand.'],{objectCounts:{temporary:8}});
add('20_indirect_wrappers','Conditional function pointer wrapped twice',String.raw`
int up(int x){return x+1;}int down(int x){return x-1;}
int apply(int(*f)(int),int x){int copy=x;return f(copy);}
int main(void){int total=0;for(int i=0;i<4;i++){int(*f)(int)=(i%2)?down:up;int a=apply(f,i);int b=apply(f,a);total+=b;}printf("%d\n",total);return 0;}`,
 '6\n',['Eight indirect callees resolved to four up and four down frames.','Return of first apply becomes second call argument without invented direct binding.'],{calls:{apply:8,up:4,down:4}});
add('21_goto_selection','Selection sort written with explicit labels and goto',String.raw`
int main(void){int a[4]={4,2,3,1},i=0,j=0,m=0,swaps=0;
outer:if(i>=3)goto done;m=i;j=i+1;
scan:if(j>=4)goto exchange;if(a[j]<a[m])m=j;j++;goto scan;
exchange:{int t=a[i];a[i]=a[m];a[m]=t;swaps++;}i++;goto outer;
done:printf("%d %d %d %d | %d\n",a[0],a[1],a[2],a[3],swaps);return 0;}`,
 '1 2 3 4 | 3\n',['Six comparisons and three exchanges including unnecessary self-swaps.','Goto edges preserve source labels and do not fabricate function return.'],{calcCounts:[{expression:'a[j]<a[m]',count:6}],objectCounts:{t:3}});
add('22_bfs_matrix','Small BFS scanning every matrix column',String.raw`
int main(void){int edge[5][5]={{0,1,1,0,0},{0,0,0,1,0},{0,0,0,1,0},{0,0,0,0,1},{0}},dist[5],queue[5],head=0,tail=0,checks=0;
for(int i=0;i<5;i++)dist[i]=-1;dist[0]=0;queue[tail++]=0;while(head<tail){int u=queue[head++];for(int v=0;v<5;v++){checks++;if(edge[u][v]&&dist[v]<0){dist[v]=dist[u]+1;queue[tail++]=v;}}}for(int i=0;i<5;i++)printf("%d ",dist[i]);printf("| %d\n",checks);return 0;}`,
 '0 1 1 2 3 | 25\n',['25 edge reads, short-circuit skips distance reads on absent edges.','Four queue writes enqueue newly reached nodes; no inferential graph shortcuts.'],{});
add('23_sort_record_copies','qsort comparator needlessly copies complete records',String.raw`
typedef struct{int key;char label[4];} Item;
int compare(const void*a,const void*b){Item first=*(const Item*)a,second=*(const Item*)b;Item again=first;return (again.key>second.key)-(again.key<second.key);}
int main(void){Item a[4]={{4,"d"},{1,"a"},{3,"c"},{2,"b"}};qsort(a,4,sizeof *a,compare);for(int i=0;i<4;i++)printf("%d%s ",a[i].key,a[i].label);puts("");return 0;}`,
 '1a 2b 3c 4d \n',['Comparator frames preserve by-value copies; count may differ across C libraries.','qsort destination mutation and callback source reads remain connected.'],{calls:{qsort:1}});
add('24_rebuild_vector','Allocate and copy the entire vector on every append',String.raw`
int main(void){int*p=NULL,n=0,copies=0;for(int value=1;value<=6;value++){int*q=malloc((size_t)(n+1)*sizeof *q);if(!q){free(p);return 1;}for(int j=0;j<n;j++){q[j]=p[j];copies++;}q[n]=value;free(p);p=q;n++;}int sum=0;for(int i=0;i<n;i++)sum+=p[i];printf("%d %d\n",sum,copies);free(p);return 0;}`,
 '21 15\n',['Six allocations and 15 copied elements; free(NULL) valid at first iteration.','No old-pointee read after free; replacement pointer only receives live q.'],{calls:{malloc:6,free:7},heapObjects:6,allHeapEnded:true});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);
manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');
console.log(`Saved ${added.length} additional predictions before execution.`);
