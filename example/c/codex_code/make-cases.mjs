import fs from 'node:fs/promises';
const cases=[];
async function add(id,style,representation,intent,code,inputs,extra={}){
 const file=id+'.c';await fs.writeFile(new URL(file,import.meta.url),code+'\n');
 cases.push({id,file,style,representation,intent,processPrediction:extra.processPrediction??'source-order reads, calculations, writes and actual call/lifetime boundaries; no fabricated macro frame',...extra,inputs});
}
const ints=a=>a.join(' ')+'\n',inputArray=a=>a.length+'\n'+ints(a);
const prefix=a=>{let t=0;return a.map(x=>String(t+=x));};
const datasets=[[7,2,5,2,9,1],[4],[9,8,7,6,5,4,3,2,1]];
await add('01_insertion_beginner','beginner','flat automatic int array','sorted array, not tree',`#include <stdio.h>
int main(void){
 int n,values[32];if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++)if(scanf("%d",&values[i])!=1)return 1;
 for(int i=1;i<n;i++){
  int save=values[i],j=i;
  while(j>0&&values[j-1]>save){
   values[j]=values[j-1]; /* @trace:shift */
   j--;
  }
  values[j]=save; /* @trace:place */
 }
 for(int i=0;i<n;i++)printf("%d%c",values[i],i+1==n?'\\n':' ');
 return 0;
}`,datasets.map((a,k)=>{const b=[...a],shift=[],place=[];for(let i=1;i<b.length;i++){const v=b[i];let j=i;while(j&&b[j-1]>v){shift.push(String(b[j-1]));b[j]=b[j-1];j--;}b[j]=v;place.push(String(v));}return{id:'input'+k,stdin:inputArray(a),stdout:ints(b),writes:{shift,place}};}),{inferenceHints:['array'],forbidInference:['linked-structure'],processPrediction:'Each right shift and saved-key placement is recorded in exact source order; no speculative values[j-1] when j=0.'});
await add('02_stable_records','structured','record array plus heap merge buffer','stable merge sort of key/original-position records',`#include <stdio.h>
#include <stdlib.h>
typedef struct {int key;int origin;} Entry;
static void join(Entry*a,Entry*b,int l,int m,int r){
 int i=l,j=m,k=l;
 while(i<m&&j<r)b[k++]=a[i].key<=a[j].key?a[i++]:a[j++];
 while(i<m){b[k++]=a[i++];}
 while(j<r){b[k++]=a[j++];}
 for(i=l;i<r;i++)a[i]=b[i];
}
static void divide(Entry*a,Entry*b,int l,int r){if(r-l<2)return;int m=l+(r-l)/2;divide(a,b,l,m);divide(a,b,m,r);join(a,b,l,m,r);}
int main(void){int n;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 Entry*a=malloc((size_t)n*sizeof*a),*b=malloc((size_t)n*sizeof*b);if(!a||!b){free(a);free(b);return 1;}
 for(int i=0;i<n;i++){if(scanf("%d",&a[i].key)!=1){free(a);free(b);return 1;}a[i].origin=i;}
 divide(a,b,0,n);
 for(int i=0;i<n;i++)printf("%d:%d%c",a[i].key,a[i].origin,i+1==n?'\\n':' ');
 free(b);free(a);return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:a.map((key,origin)=>({key,origin})).sort((a,b)=>a.key-b.key||a.origin-b.origin).map(x=>`${x.key}:${x.origin}`).join(' ')+'\n',calls:{divide:2*a.length-1,join:a.length-1}})),{inferenceHints:['array'],processPrediction:'2n-1 divide calls and n-1 joins; aggregate copies preserve both fields and source lifetimes.'});
await add('03_heap_list_slow','beginner and inefficient','separate heap records and pointer links','singly linked list reversed in place',`#include <stdio.h>
#include <stdlib.h>
typedef struct Cell{int value;struct Cell*next;} Cell;
static void dispose(Cell*p){while(p){Cell*q=p->next;free(p);p=q;}}
static int append(Cell**root,int x){Cell*q=malloc(sizeof*q);if(!q)return 0;q->value=x;q->next=NULL;if(!*root)*root=q;else{Cell*p=*root;while(p->next)p=p->next;p->next=q;}return 1;}
int main(void){int n;Cell*root=NULL;if(scanf("%d",&n)!=1||n<1||n>20)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!append(&root,x)){dispose(root);return 1;}}
 Cell*previous=NULL;Cell*cursor=root;
 while(cursor){Cell*next=cursor->next;cursor->next=previous;previous=cursor;cursor=next;}root=previous;
 int total=0;
 for(Cell*p=root;p;p=p->next){
  total+=p->value; /* @trace:sum */
 }
 printf("%d\\n",total);dispose(root);root=NULL;return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:String(a.reduce((x,y)=>x+y,0))+'\n',writes:{sum:prefix([...a].reverse())},calls:{append:a.length,dispose:1}})),{inferenceHints:['linked-structure','singly-linked-candidate']});
await add('04_index_list','flat unstructured','parallel value and next-index arrays','singly linked list without structures or pointers',`#include <stdio.h>
int main(void){int n,data[24],link[24],head=0;if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&data[i])!=1)return 1;link[i]=i+1<n?i+1:-1;}
 int p=head,previous=-1;
 while(p!=-1){int next=link[p];link[p]=previous;previous=p;p=next;}head=previous;
 int total=0;
 for(p=head;p!=-1;p=link[p]){
  total+=data[p]; /* @trace:sum */
 }
 printf("%d\\n",total);return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:String(a.reduce((x,y)=>x+y,0))+'\n',writes:{sum:prefix([...a].reverse())}})),{inferenceHints:['value-index-graph-candidate']});
await add('05_circular_sentinel','structured','automatic sentinel and doubly linked heap records','circular doubly linked list, deliberate temporary nonreciprocity during relinking',`#include <stdio.h>
#include <stdlib.h>
typedef struct Link{struct Link*next;int value;struct Link*prev;} Link;
int main(void){int n;Link sentinel={&sentinel,0,&sentinel};if(scanf("%d",&n)!=1||n<1||n>20)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1)return 1;Link*q=malloc(sizeof*q);if(!q){while(sentinel.next!=&sentinel){Link*p=sentinel.next;sentinel.next=p->next;free(p);}return 1;}
  q->value=x;q->prev=sentinel.prev;q->next=&sentinel;sentinel.prev->next=q;sentinel.prev=q;
 }
 int forward=0,backward=0;
 for(Link*p=sentinel.next;p!=&sentinel;p=p->next){forward+=p->value;} /* @trace:forward */
 for(Link*p=sentinel.prev;p!=&sentinel;p=p->prev){backward+=p->value;} /* @trace:backward */
 printf("%d %d\\n",forward,backward);
 while(sentinel.next!=&sentinel){Link*p=sentinel.next;sentinel.next=p->next;p->next->prev=&sentinel;free(p);}return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:`${a.reduce((x,y)=>x+y,0)} ${a.reduce((x,y)=>x+y,0)}\n`})),{inferenceHints:['doubly-linked-candidate','circular-linked-candidate','sentinel-candidate']});
await add('06_bst_pool','structured','contiguous record pool with child indices','binary search tree using -1 as absent child',`#include <stdio.h>
typedef struct {int key,left,right;} Node;
static Node arena[32];static int used=0;
static int insert(int root,int key){if(root<0){int p=used++;arena[p]=(Node){key,-1,-1};return p;}
 if(key<arena[root].key)arena[root].left=insert(arena[root].left,key);
 else {arena[root].right=insert(arena[root].right,key);}
 return root;}
static void inorder(int root,int*out,int*count){if(root<0)return;inorder(arena[root].left,out,count);out[(*count)++]=arena[root].key;inorder(arena[root].right,out,count);}
int main(void){int n,root=-1,out[32],count=0;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1)return 1;root=insert(root,x);}
 inorder(root,out,&count);for(int i=0;i<count;i++)printf("%d%c",out[i],i+1==count?'\\n':' ');return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:ints([...a].sort((x,y)=>x-y)),calls:{inorder:2*a.length+1}})),{inferenceHints:['record-index-graph-candidate']});
await add('07_bst_pointer','structured','individual heap nodes, pointer-to-pointer insertion','binary search tree with a repeated key',`#include <stdio.h>
#include <stdlib.h>
typedef struct N{struct N*left,*right;int key;} N;
static int insert(N**root,int value){while(*root){root=value<(*root)->key?&(*root)->left:&(*root)->right;}N*n=calloc(1,sizeof*n);if(!n)return 0;n->key=value;*root=n;return 1;}
static void visit(N*n,int*out,int*size){if(!n)return;visit(n->left,out,size);out[(*size)++]=n->key;visit(n->right,out,size);}
static void release(N*n){if(!n)return;release(n->left);release(n->right);free(n);}
int main(void){int n,out[32],size=0;N*root=NULL;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!insert(&root,x)){release(root);return 1;}}
 visit(root,out,&size);for(int i=0;i<size;i++)printf("%d%c",out[i],i+1==size?'\\n':' ');release(root);return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:ints([...a].sort((x,y)=>x-y)),calls:{insert:a.length,visit:2*a.length+1,release:2*a.length+1}})),{inferenceHints:['linked-structure','binary-tree-candidate']});
const graphs=[{n:5,e:[[0,1,4],[0,2,1],[2,1,2],[1,3,1],[2,3,5],[3,4,3],[0,4,15]]},{n:4,e:[[0,1,0],[2,3,3]]},{n:6,e:[[0,1,2],[0,2,2],[1,3,2],[2,3,1],[3,4,2],[2,5,9],[4,5,1]]}];
const graphInput=g=>`${g.n} ${g.e.length}\n`+g.e.map(e=>e.join(' ')).join('\n')+'\n';
function shortest(g){const d=Array(g.n).fill(1e9);d[0]=0;for(let k=0;k<g.n-1;k++)for(const [a,b,w]of g.e)if(d[a]<1e9)d[b]=Math.min(d[b],d[a]+w);return d;}
function scanPrediction(g,reverse=false){const d=Array(g.n).fill(1e9),seen=Array(g.n).fill(false),select=[],relax=[];d[0]=0;
 for(let k=0;k<g.n;k++){let u=-1;for(let i=0;i<g.n;i++)if(!seen[i]&&(u<0||d[i]<d[u]))u=i;if(u<0||d[u]===1e9)break;select.push(String(u));seen[u]=true;
 const edges=reverse?g.e.filter(e=>e[0]===u).reverse():g.e.filter(e=>e[0]===u).sort((a,b)=>a[1]-b[1]);
 for(const [,v,w]of edges)if(d[u]+w<d[v]){d[v]=d[u]+w;relax.push(String(d[v]));}}
 return {select,relax};}
await add('08_dijkstra_matrix','beginner','fixed two-dimensional adjacency matrix','directed weighted graph, diagonal zero, INF absent edges',`#include <stdio.h>
#define INF 1000000000
int main(void){int n,m,cost[12][12],distance[12],used[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<n;i++){distance[i]=INF;for(int j=0;j<n;j++)cost[i][j]=i==j?0:INF;}
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n||w<0||w>20)return 1;if(w<cost[a][b])cost[a][b]=w;}
 distance[0]=0;
 for(int k=0;k<n;k++){int u=-1;for(int i=0;i<n;i++)if(!used[i]&&(u<0||distance[i]<distance[u]))u=i;if(u<0||distance[u]==INF)break;
  int selected=u; /* @trace:select */
  used[selected]=1;
  for(int v=0;v<n;v++)if(cost[selected][v]!=INF){int candidate=distance[selected]+cost[selected][v];if(candidate<distance[v]){
   distance[v]=candidate; /* @trace:relax */
  }}
 }
 for(int i=0;i<n;i++){printf("%d%c",distance[i]==INF?-1:distance[i],i+1==n?'\\n':' ');}return 0;}`,graphs.map((g,k)=>({id:'input'+k,stdin:graphInput(g),stdout:ints(shortest(g).map(x=>x===1e9?-1:x)),writes:scanPrediction(g)})),{inferenceHints:['array'],processPrediction:'Prior Bellman-Ford oracle supplies distances; ordered vertex selection and successful relaxation values predicted separately. Zero-weight edges and unreachable vertices are valid.'});
function heapPrediction(g){const d=Array(g.n).fill(1e9),q=[[0,0]],select=[],relax=[];d[0]=0;while(q.length){q.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const [cost,u]=q.shift();if(cost!==d[u])continue;select.push(String(u));for(const [,v,w]of g.e.filter(e=>e[0]===u))if(cost+w<d[v]){d[v]=cost+w;relax.push(String(d[v]));q.push([d[v],v]);}}return {select,relax};}
await add('09_dijkstra_csr_heap','advanced structured','CSR offset/target/weight arrays and record binary heap','weighted graph plus implicit binary heap',`#include <stdio.h>
#define INF 1000000000
typedef struct {int distance,vertex;} Pair;
typedef struct {Pair data[128];int size;} Heap;
static int less(Pair a,Pair b){return a.distance<b.distance||(a.distance==b.distance&&a.vertex<b.vertex);}
static void push(Heap*h,Pair x){int i=h->size++;while(i&&less(x,h->data[(i-1)/2])){h->data[i]=h->data[(i-1)/2];i=(i-1)/2;}h->data[i]=x;}
static Pair pop(Heap*h){Pair answer=h->data[0],last=h->data[--h->size];int i=0;while(2*i+1<h->size){int c=2*i+1;if(c+1<h->size&&less(h->data[c+1],h->data[c]))c++;if(!less(h->data[c],last))break;h->data[i]=h->data[c];i=c;}if(h->size)h->data[i]=last;return answer;}
int main(void){int n,m,from[60],to[60],weight[60],offset[13]={0},cursor[12],target[60],edgeweight[60],dist[12];Heap heap={0};
 if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<m;i++){if(scanf("%d%d%d",&from[i],&to[i],&weight[i])!=3||from[i]<0||from[i]>=n||to[i]<0||to[i]>=n||weight[i]<0||weight[i]>20)return 1;offset[from[i]+1]++;}
 for(int i=1;i<=n;i++)offset[i]+=offset[i-1];
 for(int i=0;i<n;i++){cursor[i]=offset[i];dist[i]=INF;}
 for(int i=0;i<m;i++){int p=cursor[from[i]]++;target[p]=to[i];edgeweight[p]=weight[i];}
 dist[0]=0;push(&heap,(Pair){0,0});
 while(heap.size){Pair at=pop(&heap);if(at.distance!=dist[at.vertex])continue;
  int selected=at.vertex; /* @trace:select */
  for(int p=offset[selected];p<offset[selected+1];p++){int v=target[p],candidate=at.distance+edgeweight[p];if(candidate<dist[v]){
   dist[v]=candidate; /* @trace:relax */
   push(&heap,(Pair){candidate,v});
  }}
 }
 for(int i=0;i<n;i++){printf("%d%c",dist[i]==INF?-1:dist[i],i+1==n?'\\n':' ');}return 0;}`,graphs.map((g,k)=>{const p=heapPrediction(g);return{id:'input'+k,stdin:graphInput(g),stdout:ints(shortest(g).map(x=>x===1e9?-1:x)),writes:p,calls:{push:p.relax.length+1,pop:p.relax.length+1}};}),{inferenceHints:['array'],processPrediction:'Priority-queue operations predicted by a sorted JS queue, independent of C heap implementation; stale entries are skipped, aggregate returns retain both fields.'});
await add('10_dijkstra_linked_edges','structured','pointer array of adjacency list roots; individually allocated edge records','weighted indexed graph with per-edge destination/cost/next',`#include <stdio.h>
#include <stdlib.h>
#define INF 1000000000
typedef struct Edge{int to,weight;struct Edge*next;} Edge;
static void clear(Edge**row,int n){for(int i=0;i<n;i++)while(row[i]){Edge*e=row[i];row[i]=e->next;free(e);}}
int main(void){int n,m,d[12],used[12]={0};Edge*row[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n||w<0||w>20){clear(row,n);return 1;}Edge*e=malloc(sizeof*e);if(!e){clear(row,n);return 1;}*e=(Edge){b,w,row[a]};row[a]=e;}
 for(int i=0;i<n;i++)d[i]=INF;
 d[0]=0;
 for(int k=0;k<n;k++){int u=-1;for(int i=0;i<n;i++)if(!used[i]&&(u<0||d[i]<d[u]))u=i;if(u<0||d[u]==INF)break;
  int selected=u; /* @trace:select */
  used[selected]=1;
  for(Edge*e=row[selected];e;e=e->next){int candidate=d[selected]+e->weight;if(candidate<d[e->to]){
   d[e->to]=candidate; /* @trace:relax */
  }}
 }
 for(int i=0;i<n;i++){printf("%d%c",d[i]==INF?-1:d[i],i+1==n?'\\n':' ');}clear(row,n);return 0;}`,graphs.map((g,k)=>({id:'input'+k,stdin:graphInput(g),stdout:ints(shortest(g).map(x=>x===1e9?-1:x)),writes:scanPrediction(g,true),calls:{clear:1}})),{inferenceHints:['linked-root-collection','indexed-graph-candidate']});
function forest(g){const p=Array.from({length:g.n},(_,i)=>i),root=x=>p[x]===x?x:(p[x]=root(p[x]));let total=0,components=g.n;const sums=[];
 for(const [a,b,w]of [...g.e].sort((a,b)=>a[2]-b[2])){let x=root(a),y=root(b);if(x!==y){p[x]=y;total+=w;components--;sums.push(String(total));}}return{total,components,sums};}
await add('11_prim_spaghetti','spaghetti but bounded','matrix flattened to one-dimensional array; labels and manual scans','minimum spanning forest, including disconnected input',`#include <stdio.h>
#define INF 1000000000
int main(void){int n,m,a[144],b[12],z[12]={0},i,j,k,u,t=0,c=0;
 if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(i=0;i<n*n;i++)a[i]=INF;
 for(i=0;i<m;i++){int x,y,w;if(scanf("%d%d%d",&x,&y,&w)!=3||x<0||x>=n||y<0||y>=n||w<0||w>20)return 1;if(w<a[x*n+y]){a[x*n+y]=w;a[y*n+x]=w;}}
 for(i=0;i<n;i++)b[i]=INF;
 k=0;
again:
 if(k==n)goto finished;
 u=-1;i=0;
scan:
 if(i>=n)goto picked;
 if(!z[i]&&(u<0||b[i]<b[u]))u=i;
 i++;goto scan;
picked:
 if(b[u]==INF){b[u]=0;c++;}z[u]=1;t+=b[u];k++;j=0;
edges:
 if(j>=n)goto again;
 if(!z[j]&&a[u*n+j]<b[j])b[j]=a[u*n+j];
 j++;goto edges;
finished:
 printf("%d %d\\n",t,c);return 0;}`,graphs.map((g,k)=>({id:'input'+k,stdin:graphInput(g),stdout:`${forest(g).total} ${forest(g).components}\n`})),{inferenceHints:['array'],processPrediction:'No fabricated calls for goto labels; each vertex finalized once; disconnected components start at zero cost.'});
await add('12_kruskal_dsu','structured','edge records sorted through callback, parent and size parallel arrays','minimum spanning forest plus disjoint-set parent forest',`#include <stdio.h>
#include <stdlib.h>
typedef struct{int a,b,w,order;} Edge;
static int compare(const void*x,const void*y){const Edge*a=x,*b=y;return a->w!=b->w?(a->w>b->w)-(a->w<b->w):a->order-b->order;}
static int root(int*p,int v){while(p[v]!=v){p[v]=p[p[v]];v=p[v];}return v;}
int main(void){int n,m,p[12],size[12],total=0,components;Edge e[60];if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<m;i++){if(scanf("%d%d%d",&e[i].a,&e[i].b,&e[i].w)!=3||e[i].a<0||e[i].a>=n||e[i].b<0||e[i].b>=n||e[i].w<0||e[i].w>20)return 1;e[i].order=i;}
 for(int i=0;i<n;i++){p[i]=i;size[i]=1;}components=n;qsort(e,(size_t)m,sizeof e[0],compare);
 for(int i=0;i<m;i++){int a=root(p,e[i].a),b=root(p,e[i].b);if(a==b)continue;if(size[a]<size[b]){int temp=a;a=b;b=temp;}p[b]=a;size[a]+=size[b];components--;
  total+=e[i].w; /* @trace:total */
 }
 printf("%d %d\\n",total,components);return 0;}`,graphs.map((g,k)=>({id:'input'+k,stdin:graphInput(g),stdout:`${forest(g).total} ${forest(g).components}\n`,writes:{total:forest(g).sums},calls:{root:g.e.length*2}})),{inferenceHints:['value-index-graph-candidate','parallel-array-metadata-candidate']});
const grids=[{h:3,w:4,a:[0,0,1,0,1,0,1,0,0,0,0,0]},{h:2,w:3,a:[0,1,0,1,1,0]},{h:1,w:1,a:[0]}];
function gridOracle(g){const d=Array(g.a.length).fill(-1),q=[0],writes=[];d[0]=0;for(let h=0;h<q.length;h++){const u=q[h],r=Math.floor(u/g.w),c=u%g.w;for(const [dr,dc]of [[0,1],[1,0],[0,-1],[-1,0]]){const y=r+dr,x=c+dc,v=y*g.w+x;if(y>=0&&y<g.h&&x>=0&&x<g.w&&!g.a[v]&&d[v]<0){d[v]=d[u]+1;writes.push(String(d[v]));q.push(v);}}}return {distance:d.at(-1),writes};}
const gridInputs=grids.map((g,k)=>({id:'input'+k,stdin:`${g.h} ${g.w}\n`+ints(g.a),stdout:gridOracle(g).distance+'\n',writes:{discover:gridOracle(g).writes}}));
await add('13_grid_flat_ring','structured','flat cell storage and circular queue in owner struct','rectangular grid BFS with ring queue',`#include <stdio.h>
typedef struct{int data[8];int front,back,count;} Ring;
static int take(Ring*q){int v=q->data[q->front];q->front=(q->front+1)%8;q->count--;return v;}
static void put(Ring*q,int v){q->data[q->back]=v;q->back=(q->back+1)%8;q->count++;}
int main(void){int h,w,a[64],d[64],dr[4]={0,1,0,-1},dc[4]={1,0,-1,0};Ring queue={0};
 if(scanf("%d%d",&h,&w)!=2||h<1||h>4||w<1||w>4)return 1;
 for(int i=0;i<h*w;i++){if(scanf("%d",&a[i])!=1)return 1;d[i]=-1;}if(a[0])return 1;
 d[0]=0;put(&queue,0);
 while(queue.count){int u=take(&queue);for(int k=0;k<4;k++){int y=u/w+dr[k],x=u%w+dc[k];if(y<0||y>=h||x<0||x>=w)continue;int v=y*w+x;if(a[v]||d[v]!=-1)continue;
   d[v]=d[u]+1; /* @trace:discover */
   if(queue.count==8)return 1;
   put(&queue,v);
 }}printf("%d\\n",d[h*w-1]);return 0;}`,gridInputs,{inferenceHints:['array','indexed-storage-candidate']});
await add('14_grid_matrix_queue','beginner','two-dimensional arrays and coordinate pair queue','rectangular grid BFS with monotone queue',`#include <stdio.h>
typedef struct{int y,x;} Point;
int main(void){int h,w,a[4][4],d[4][4],dy[4]={0,1,0,-1},dx[4]={1,0,-1,0};Point q[16];int front=0,back=0;
 if(scanf("%d%d",&h,&w)!=2||h<1||h>4||w<1||w>4)return 1;
 for(int y=0;y<h;y++){for(int x=0;x<w;x++){if(scanf("%d",&a[y][x])!=1)return 1;d[y][x]=-1;}}
 if(a[0][0])return 1;
 d[0][0]=0;q[back++]=(Point){0,0};
 while(front<back){Point p=q[front++];for(int k=0;k<4;k++){int y=p.y+dy[k],x=p.x+dx[k];if(y<0||y>=h||x<0||x>=w||a[y][x]||d[y][x]!=-1)continue;
   d[y][x]=d[p.y][p.x]+1; /* @trace:discover */
   q[back++]=(Point){y,x};
 }}printf("%d\\n",d[h-1][w-1]);return 0;}`,gridInputs,{inferenceHints:['array','queue-candidate']});
await add('15_bitset_reachability','compact advanced','unsigned 64-bit row masks','directed reachability graph encoded as bits, no node structures',`#include <stdio.h>
#include <stdint.h>
int main(void){int n,m;uint64_t rows[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<n;i++)rows[i]=UINT64_C(1)<<i;
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n)return 1;rows[a]|=UINT64_C(1)<<b;}
 for(int k=0;k<n;k++)for(int i=0;i<n;i++)if(rows[i]&(UINT64_C(1)<<k))rows[i]|=rows[k];
 for(int i=0;i<n;i++){int count=0;for(int j=0;j<n;j++)if(rows[i]&(UINT64_C(1)<<j))count++;printf("%d%c",count,i+1==n?'\\n':' ');}return 0;}`,graphs.map((g,k)=>{const counts=[];for(let s=0;s<g.n;s++){const seen=new Set([s]),q=[s];for(let i=0;i<q.length;i++)for(const [a,b]of g.e)if(a===q[i]&&!seen.has(b)){seen.add(b);q.push(b);}counts.push(seen.size);}return{id:'input'+k,stdin:graphInput(g),stdout:ints(counts)};}),{inferenceHints:['array'],processPrediction:'Bitwise OR and shifts retain uint64 types and bit widths; high-level graph inference is intentionally difficult.'});
const versionInputs=[{a:[3,1,4,1,5,9],ops:[[0,2,7,1,5],[1,0,-2,0,3],[0,5,1,3,6],[2,4,4,0,6]]},{a:[8],ops:[[0,0,-3,0,1],[0,0,2,0,1]]}];
function versionsOracle(s){const versions=[s.a.slice()],answers=[];let updateCalls=0;for(const [v,p,d,l,r]of s.ops){let lo=0,hi=s.a.length;do{updateCalls++;if(hi-lo===1)break;const mid=Math.floor((lo+hi)/2);if(p<mid)hi=mid;else lo=mid;}while(true);const a=versions[v].slice();a[p]+=d;versions.push(a);answers.push(a.slice(l,r).reduce((a,b)=>a+b,0));}return{stdout:ints(answers)+ints(versions.map(a=>a.reduce((x,y)=>x+y,0))),updateCalls};}
await add('16_persistent_segment_tree','advanced readable','arena of nodes with pointers shared across immutable versions','persistent segment trees: individual roots are trees, union of versions is a shared DAG',`#include <stdio.h>
#include <stddef.h>

enum { MAX_ITEMS = 16, MAX_UPDATES = 16, MAX_NODES = 128 };
typedef struct Node Node;
struct Node {
    int sum;
    const Node *left;
    const Node *right;
};
typedef struct {
    Node nodes[MAX_NODES];
    size_t used;
} Arena;

static Node *make_node(Arena *arena, int sum, const Node *left, const Node *right) {
    if (arena->used == MAX_NODES) return NULL;
    Node *node = &arena->nodes[arena->used++];
    *node = (Node){sum, left, right};
    return node;
}

static const Node *build(Arena *arena, const int *values, int begin, int end) {
    if (end - begin == 1) return make_node(arena, values[begin], NULL, NULL);
    int middle = begin + (end - begin) / 2;
    const Node *left = build(arena, values, begin, middle);
    const Node *right = build(arena, values, middle, end);
    if (left == NULL || right == NULL) return NULL;
    return make_node(arena, left->sum + right->sum, left, right);
}

static const Node *update(Arena *arena, const Node *old, int begin, int end,
                          int position, int delta) {
    if (end - begin == 1) return make_node(arena, old->sum + delta, NULL, NULL);
    int middle = begin + (end - begin) / 2;
    const Node *left = old->left;
    const Node *right = old->right;
    if (position < middle) left = update(arena, left, begin, middle, position, delta);
    else right = update(arena, right, middle, end, position, delta);
    if (left == NULL || right == NULL) return NULL;
    return make_node(arena, left->sum + right->sum, left, right);
}

static int query(const Node *node, int begin, int end, int from, int to) {
    if (to <= begin || end <= from) return 0;
    if (from <= begin && end <= to) return node->sum;
    int middle = begin + (end - begin) / 2;
    return query(node->left, begin, middle, from, to)
         + query(node->right, middle, end, from, to);
}

int main(void) {
    int n, operations, values[MAX_ITEMS];
    Arena arena = {0};
    const Node *versions[MAX_UPDATES + 1] = {0};
    if (scanf("%d%d", &n, &operations) != 2 || n < 1 || n > MAX_ITEMS
        || operations < 1 || operations > MAX_UPDATES) return 1;
    for (int i = 0; i < n; ++i) {
        if (scanf("%d", &values[i]) != 1 || values[i] < -100 || values[i] > 100) return 1;
    }
    versions[0] = build(&arena, values, 0, n);
    if (versions[0] == NULL) return 1;
    for (int i = 0; i < operations; ++i) {
        int base, position, delta, from, to;
        if (scanf("%d%d%d%d%d", &base, &position, &delta, &from, &to) != 5
            || base < 0 || base > i || position < 0 || position >= n
            || delta < -100 || delta > 100 || from < 0 || from >= to || to > n) return 1;
        versions[i + 1] = update(&arena, versions[base], 0, n, position, delta);
        if (versions[i + 1] == NULL) return 1;
        printf("%d%c", query(versions[i + 1], 0, n, from, to),
               i + 1 == operations ? '\\n' : ' ');
    }
    for (int i = 0; i <= operations; ++i) {
        printf("%d%c", query(versions[i], 0, n, 0, n), i == operations ? '\\n' : ' ');
    }
    return 0;
}`,versionInputs.map((s,k)=>({id:'input'+k,stdin:`${s.a.length} ${s.ops.length}\n`+ints(s.a)+s.ops.map(x=>x.join(' ')).join('\n')+'\n',stdout:versionsOracle(s).stdout,calls:{build:2*s.a.length-1,update:versionsOracle(s).updateCalls}})),{inferenceHints:['array'],processPrediction:'Creation copies only the root-to-leaf path; other subtrees retain their identity. Old versions must remain unchanged. No heap allocation for arena nodes; no fictitious separate node allocations.'});
await add('17_fenwick','compact standard','one-based numeric array, implicit lowbit parent relation','Fenwick tree without explicit links',`#include <stdio.h>
static void add(int*t,int n,int p,int x){for(;p<=n;p+=p&-p){
 t[p]+=x; /* @trace:update */
}}
static int prefix(const int*t,int p){int sum=0;for(;p>0;p-=p&-p)sum+=t[p];return sum;}
int main(void){int n,a[32],t[33]={0};if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&a[i])!=1||a[i]<-100||a[i]>100)return 1;add(t,n,i+1,a[i]);}
 for(int i=1;i<=n;i++){printf("%d%c",prefix(t,i),i==n?'\\n':' ');}return 0;}`,datasets.slice(0,2).map((a,k)=>{const t=Array(a.length+1).fill(0),writes=[];a.forEach((x,i)=>{for(let p=i+1;p<=a.length;p+=p&-p){t[p]+=x;writes.push(String(t[p]));}});return{id:'input'+k,stdin:inputArray(a),stdout:ints(prefix(a)),writes:{update:writes},calls:{add:a.length,prefix:a.length}};}),{inferenceHints:['array'],processPrediction:'Each add follows p += lowbit(p), each query follows p -= lowbit(p); array values are accumulated partial sums, not node indices.'});
await add('18_vector_reallocate_slow','intentionally inefficient','owner struct with size/capacity and heap array, realloc every insertion','dynamic array with unnecessary copying and capacity growth by one',`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct{int*data;size_t size,capacity;} Vector;
static int append(Vector*v,int x){int*next=realloc(v->data,(v->size+1)*sizeof*next);if(!next)return 0;v->data=next;v->capacity=v->size+1;v->data[v->size++]=x;return 1;}
int main(void){int n;Vector v={0};if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!append(&v,x)){free(v.data);return 1;}
  int*copy=malloc(v.size*sizeof*copy);if(!copy){free(v.data);return 1;}memcpy(copy,v.data,v.size*sizeof*copy);memcpy(v.data,copy,v.size*sizeof*copy);free(copy);
 }for(size_t i=0;i<v.size;i++){printf("%d%c",v.data[i],i+1==v.size?'\\n':' ');}free(v.data);return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:ints(a),calls:{append:a.length}})),{inferenceHints:['dynamic-array'],processPrediction:'Every append resizes once; every iteration allocates and frees a redundant copy. Preserve both memcpy calls and actual lifetime; do not optimize the inefficiency away.'});
await add('19_false_tree_names','beginner misleading names','scalar numeric arrays named parent/left/right, values used only in arithmetic','parallel measurements, not a tree or linked structure',`#include <stdio.h>
int main(void){int n,parent[24],left[24],right[24];if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&parent[i])!=1||parent[i]<-100||parent[i]>100)return 1;left[i]=parent[i]+1;right[i]=parent[i]*2;}
 for(int i=0;i<n;i++){printf("%d%c",left[i]+right[i],i+1==n?'\\n':' ');}return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:ints(a.map(x=>3*x+1))})),{inferenceHints:['array'],forbidInference:['binary-tree-candidate','linked-structure','record-index-graph-candidate'],processPrediction:'Variable names must not cause node/edge interpretation. The values are never dereferenced or used as indices.'});
await add('20_shared_dag','structured','pointers into a single heap record array, diamond sharing','directed acyclic graph with shared leaf, not one binary tree',`#include <stdio.h>
#include <stdlib.h>
typedef struct N{int id,value;struct N*left,*right;} N;
static int visit(const N*p,unsigned*seen){if(!p||(*seen&(1u<<p->id)))return 0;*seen|=1u<<p->id;return p->value+visit(p->left,seen)+visit(p->right,seen);}
int main(void){N*p=calloc(4,sizeof*p);if(!p)return 1;for(int i=0;i<4;i++){p[i].id=i;if(scanf("%d",&p[i].value)!=1||p[i].value<-100||p[i].value>100){free(p);return 1;}}
 p[0].left=&p[1];p[0].right=&p[2];p[1].right=&p[3];p[2].left=&p[3];
 unsigned seen=0;int sum=visit(p,&seen);printf("%d %u\\n",sum,seen);free(p);return 0;}`,[{id:'input0',stdin:'3 5 7 11\n',stdout:'26 15\n',calls:{visit:9}},{id:'input1',stdin:'1 1 1 1\n',stdout:'4 15\n',calls:{visit:9}}],{inferenceHints:['record-graph-candidate'],processPrediction:'Both parents reference the same leaf object. Traversal visits it twice but processes it once; view must preserve sharing rather than duplicate storage. Inspect final live topology, not only a transient tree candidate.'});
const sccGraphs=[{n:8,e:[[0,1,1],[1,2,1],[2,0,1],[2,3,1],[3,4,1],[4,3,1],[4,5,1],[5,6,1],[6,7,1],[7,6,1]]},{n:5,e:[[0,0,1],[1,2,1],[2,1,1],[3,4,1]]},{n:1,e:[]}];
function componentsOracle(g){const reach=Array.from({length:g.n},(_,i)=>Array.from({length:g.n},(_,j)=>i===j));for(const[a,b]of g.e)reach[a][b]=true;for(let k=0;k<g.n;k++)for(let i=0;i<g.n;i++)for(let j=0;j<g.n;j++)reach[i][j] ||= reach[i][k]&&reach[k][j];return Array.from({length:g.n},(_,i)=>Array.from({length:g.n},(_,j)=>j).find(j=>reach[i][j]&&reach[j][i]));}
await add('21_tarjan_components','advanced readable','forward-star parallel edge arrays and explicit DFS stack','directed cyclic graph, SCC partition, DFS forest and stack coexist',`#include <stdio.h>

enum { VERTICES = 16, EDGES = 64 };
typedef struct {
    int first[VERTICES];
    int destination[EDGES];
    int next[EDGES];
    int edge_count;
} Graph;
typedef struct {
    int discovery[VERTICES];
    int low[VERTICES];
    int active[VERTICES];
    int component[VERTICES];
    int stack[VERTICES];
    int stack_size;
    int clock;
    int component_count;
} Search;

static void connect(Graph *graph, int from, int to) {
    int edge = graph->edge_count++;
    graph->destination[edge] = to;
    graph->next[edge] = graph->first[from];
    graph->first[from] = edge;
}

static void explore(const Graph *graph, Search *search, int vertex) {
    search->discovery[vertex] = ++search->clock;
    search->low[vertex] = search->discovery[vertex];
    search->stack[search->stack_size++] = vertex;
    search->active[vertex] = 1;

    for (int edge = graph->first[vertex]; edge != -1; edge = graph->next[edge]) {
        int next = graph->destination[edge];
        if (search->discovery[next] == 0) {
            explore(graph, search, next);
            if (search->low[next] < search->low[vertex]) {
                search->low[vertex] = search->low[next];
            }
        } else if (search->active[next] && search->discovery[next] < search->low[vertex]) {
            search->low[vertex] = search->discovery[next];
        }
    }

    if (search->low[vertex] == search->discovery[vertex]) {
        int member;
        do {
            member = search->stack[--search->stack_size];
            search->active[member] = 0;
            search->component[member] = search->component_count;
        } while (member != vertex);
        ++search->component_count;
    }
}

int main(void) {
    Graph graph = {0};
    Search search = {0};
    int n, m;
    if (scanf("%d%d", &n, &m) != 2 || n < 1 || n > VERTICES || m < 0 || m > EDGES) return 1;
    for (int vertex = 0; vertex < n; ++vertex) graph.first[vertex] = -1;
    for (int i = 0; i < m; ++i) {
        int from, to, unused_weight;
        if (scanf("%d%d%d", &from, &to, &unused_weight) != 3
            || from < 0 || from >= n || to < 0 || to >= n) return 1;
        connect(&graph, from, to);
    }
    for (int vertex = 0; vertex < n; ++vertex) {
        if (search.discovery[vertex] == 0) explore(&graph, &search, vertex);
    }
    for (int vertex = 0; vertex < n; ++vertex) {
        int representative = vertex;
        for (int other = 0; other < vertex; ++other) {
            if (search.component[other] == search.component[vertex]) {
                representative = other;
                break;
            }
        }
        printf("%d%c", representative, vertex + 1 == n ? '\\n' : ' ');
    }
    return 0;
}`,sccGraphs.map((g,k)=>({id:'input'+k,stdin:graphInput(g),stdout:ints(componentsOracle(g)),calls:{connect:g.e.length,explore:g.n}})),{inferenceHints:['array'],processPrediction:'Each vertex enters DFS once; active stack differs from call stack; low links propagate after child return. Component oracle uses mutual reachability, not Tarjan. Cyclic graph must not become an asserted tree merely because DFS calls form a tree.'});
const words=[['ABCBDAB','BDCABA'],['AAAA','AA'],['XYZ','ABC']];
function lcsOracle(a,b){let best=0;for(let mask=0;mask<(1<<a.length);mask++){let at=0,count=0,valid=true;for(let i=0;i<a.length;i++)if(mask&(1<<i)){at=b.indexOf(a[i],at);if(at<0){valid=false;break;}at++;count++;}if(valid)best=Math.max(best,count);}const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0)),writes=[];for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);writes.push(String(dp[i][j]));}return{best,writes};}
await add('22_lcs_scattered_grid','spaghetti and allocation-heavy','pointer-to-pointer table with separately allocated rows','dynamic-programming grid, not linked list despite multiple indirection',`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){char a[13],b[13];if(scanf("%12s%12s",a,b)!=2)return 1;int n=(int)strlen(a),m=(int)strlen(b),**table=calloc((size_t)n+1,sizeof*table);if(!table)return 1;
 for(int k=0;k<=n;k++){table[k]=calloc((size_t)m+1,sizeof**table);if(!table[k]){for(int t=0;t<k;t++)free(table[t]);free(table);return 1;}}
 int i=1,j=1,value=0;
row:
 if(i>n)goto done;
 j=1;
column:
 if(j>m){i++;goto row;}
 if(a[i-1]==b[j-1]){value=table[i-1][j-1]+1;goto store;}
 value=table[i-1][j];if(table[i][j-1]>value)value=table[i][j-1];
store:
 table[i][j]=value; /* @trace:cell */
 j++;goto column;
done:
 printf("%d\\n",table[n][m]);for(int k=0;k<=n;k++)free(table[k]);free(table);return 0;}`,words.map(([a,b],k)=>({id:'input'+k,stdin:a+'\n'+b+'\n',stdout:lcsOracle(a,b).best+'\n',writes:{cell:lcsOracle(a,b).writes}})),{inferenceHints:['array'],processPrediction:'All table cells are predicted in row order; final LCS oracle exhaustively enumerates subsequences. Pointer table and rows are distinct allocations and must remain so.'});
await add('23_macro_selection_sort','compact macro-heavy','flat array, do-while SWAP macro and nested comparison macros','selection sort preserving macro scope, without imaginary function frames',`#include <stdio.h>
#define BEFORE(a,b) ((a)<(b))
#define PICK(a,b) (BEFORE((a),(b))?(a):(b))
#define SWAP(a,b) do {int temporary=(a);(a)=(b);(b)=temporary;} while(0)
int main(void){int n,a[24];if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++)if(scanf("%d",&a[i])!=1)return 1;
 for(int i=0;i<n;i++){int k=i;for(int j=i+1;j<n;j++)if(BEFORE(a[j],a[k]))k=j;if(k!=i)SWAP(a[i],a[k]);}
 for(int i=0;i<n;i++){printf("%d%c",a[i],i+1==n?'\\n':' ');}printf("%d\\n",PICK(a[0],a[n-1]));return 0;}`,datasets.slice(0,2).map((a,k)=>({id:'input'+k,stdin:inputArray(a),stdout:ints([...a].sort((a,b)=>a-b))+Math.min(...a)+'\n',calls:{SWAP:0,BEFORE:0,PICK:0}})),{inferenceHints:['array'],processPrediction:'Macro operands are actual source reads; statement macro temporary lives in its own lexical scope, not a function activation. No macro input is evaluated just to observe it.'});
// Metamorphic variants keep input, algorithm and prior oracle unchanged.
function expandStatements(source){let quote=null,escaped=false,out='';for(const ch of source){out+=ch;if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch===quote)quote=null;}else if(ch==='"'||ch==="'")quote=ch;else if(';{}'.includes(ch))out+='\n';}return out;}
const csr=cases.find(c=>c.id==='09_dijkstra_csr_heap');
await add('24_csr_statement_layout','same advanced algorithm, expanded line layout',csr.representation,csr.intent,expandStatements(await fs.readFile(new URL(csr.file,import.meta.url),'utf8')),csr.inputs.map(i=>({...i,writes:undefined})),{inferenceHints:csr.inferenceHints,processPrediction:'Metamorphic counterpart of 09. Only whitespace changes; output and push/pop counts must match. Original inline marker positions no longer identify the assignment, so no tagged-line WRITE check is claimed.'});
const bits=cases.find(c=>c.id==='15_bitset_reachability');
await add('25_bitset_literal_variant','same compact algorithm without constant macro',bits.representation,bits.intent,(await fs.readFile(new URL(bits.file,import.meta.url),'utf8')).replaceAll('UINT64_C(1)','1ULL'),bits.inputs,{inferenceHints:bits.inferenceHints,processPrediction:'Metamorphic counterpart of 15. Replace UINT64_C(1) by 1ULL; bounded shifts and conversion preserve all outputs. Tests source spelling sensitivity without changing behavior.'});
const sentinel=cases.find(c=>c.id==='05_circular_sentinel');
await add('26_sentinel_pointer_alias','same structured algorithm with explicit sentinel pointer alias',sentinel.representation,sentinel.intent,(await fs.readFile(new URL(sentinel.file,import.meta.url),'utf8')).replace('if(scanf("%d",&n)','Link*anchor=&sentinel;if(scanf("%d",&n)').replaceAll('p!=&sentinel','p!=anchor'),sentinel.inputs,{inferenceHints:sentinel.inferenceHints,processPrediction:'Metamorphic counterpart of 05. Traversal compares a pointer alias instead of direct &sentinel. Object identity, topology, output and memory operations must stay equivalent.'});
await fs.writeFile(new URL('cases.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),predictionMethod:'independent JavaScript algorithms and analytically derived call/write counts, created before running C',cases},null,2)+'\n');
