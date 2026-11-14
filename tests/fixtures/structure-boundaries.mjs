// Independent source-derived expectations. Production inference never reads this.
const io='#include <stdio.h>\n#include <stdlib.h>\n';
export const boundaryCases=[
 {id:'intrusive-hash-list',area:'mixed',stdout:'4 6 6 4 ',expect:{orders:[[0,1,2],[2,0,1]],hashKeys:[1,3,2],roles:['bucket','next','prev']},source:io+String.raw`
typedef struct N{int key;struct N *bucket,*next,*prev;}N;
N v[3]={{1,0,0,0},{3,0,0,0},{2,0,0,0}};N*tab[2],*head,*tail;
void insert(N*p){int h=p->key%2;p->bucket=tab[h];tab[h]=p;p->prev=tail;if(tail)tail->next=p;else head=p;tail=p;}
N*lookup(int k){for(N*p=tab[k%2];p;p=p->bucket)if(p->key==k)return p;return 0;}
int walk(void){int n=0;for(N*p=head;p;p=p->next)n+=p->key;return n;}
int main(void){for(int i=0;i<3;i++)insert(v+i);printf("%d %d ",lookup(3)->key+lookup(1)->key,walk());N*p=lookup(2);p->prev->next=0;tail=p->prev;p->next=head;head->prev=p;p->prev=0;head=p;printf("%d %d ",walk(),lookup(3)->key+lookup(1)->key);return 0;}`},
 {id:'tree-queue-shared-records',area:'mixed',stdout:'6 6 ',expect:{treeEdges:[[0,1],[0,2]],queueOrder:[0,1,2]},source:io+String.raw`
typedef struct N{int x;struct N*l,*r,*q;}N;N a[3]={{3,0,0,0},{1,0,0,0},{2,0,0,0}};N*root=a,*front,*back;
int tree(N*p){return p?p->x+tree(p->l)+tree(p->r):0;}
void put(N*p){if(back)back->q=p;else front=p;back=p;}
int main(void){a[0].l=a+1;a[0].r=a+2;put(a);put(a+1);put(a+2);printf("%d ",tree(root));int n=0;while(front){N*p=front;front=p->q;n+=p->x;}back=0;printf("%d ",n);return 0;}`},
 {id:'rotation-and-split',area:'transition',stdout:'6 3 6 3 6 ',expect:{rootOrders:[[0,1,2],[0],[1,2,0],[1,2],[1,2,0]],cyclic:false},source:io+String.raw`
typedef struct N{int k;struct N*l,*r;}N;N a[3]={{3,0,0},{2,0,0},{1,0,0}};N*root=a;
int walk(N*p){return p?p->k+walk(p->l)+walk(p->r):0;}
void mark(void){printf("%d ",walk(root));}
int main(void){a[0].l=a+1;a[1].l=a+2;mark();N*p=root->l;root->l=p->r;mark();p->r=root;root=p;mark();N*part=root->r;root->r=0;mark();root->r=part;mark();return 0;}`},
 {id:'temporary-cycle',area:'transition',stdout:'1 1 1 ',expect:{cycleStates:[false,true,false]},source:io+String.raw`
typedef struct N{int x;struct N*n;}N;N a[2]={{1,0},{2,0}};N*head=a;
void mark(void){N*p=head;for(int i=0;i<2&&p;i++)p=p->n;printf("%d ",head->x);}
int main(void){a[0].n=a+1;mark();a[1].n=a;mark();a[1].n=0;mark();return 0;}`},
 {id:'allocation-reuse',area:'reuse',stdout:'3 9 ',expect:{distinctAllocations:true,oldExcluded:true},source:io+String.raw`
typedef struct N{int x;struct N*n;}N;N*head;
int walk(N*p){int s=0;for(;p;p=p->n)s+=p->x;return s;}
int main(void){N*p=calloc(2,sizeof *p);if(!p)return 0;p[0].x=1;p[1].x=2;p[0].n=p+1;head=p;printf("%d ",walk(head));head=0;free(p);p=calloc(2,sizeof *p);if(!p)return 0;p[0].x=4;p[1].x=5;p[0].n=p+1;head=p;printf("%d ",walk(head));head=0;free(p);return 0;}`},
 {id:'pool-partition-reset',area:'reuse',stdout:'0 0 2 0 1 2 ',expect:{before:[[0,1],[2]],after:[[0],[1],[2]],finalNoMergeSupport:true},source:io+String.raw`
typedef struct N{struct N*p;int x;}N;N a[3];
N*f(N*p){if(p->p==p)return p;return p->p=f(p->p);}
void join(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<3;i++){a[i].p=a+i;a[i].x=i;}join(a,a+1);for(int i=0;i<3;i++)printf("%d ",f(a+i)->x);for(int i=0;i<3;i++)a[i].p=a+i;for(int i=0;i<3;i++)printf("%d ",f(a+i)->x);return 0;}`},
 {id:'relocating-index-list',area:'reuse',stdout:'3 10 ',expect:{old:[0,1],current:[0,1,2,3],oldAllocationExcluded:true},source:io+String.raw`
typedef struct{int x,next;}N;N*a;int head=0;
int walk(void){int s=0;for(int i=head;i!=-1;i=a[i].next)s+=a[i].x;return s;}
int main(void){a=malloc(2*sizeof *a);if(!a)return 0;a[0]=(N){1,1};a[1]=(N){2,-1};printf("%d ",walk());N*p=realloc(a,4*sizeof *a);if(!p){free(a);return 0;}a=p;a[1].next=2;a[2]=(N){3,3};a[3]=(N){4,-1};printf("%d ",walk());free(a);return 0;}`},
 {id:'pool-detach-reinsert',area:'reuse',stdout:'6 4 12 ',expect:{orders:[[0,1,2],[0,2],[1,0,2]],valueReused:8},source:io+String.raw`
typedef struct N{int x;struct N*n;}N;N a[3]={{1,0},{2,0},{3,0}};N*head=a;
int walk(void){int s=0;for(N*p=head;p;p=p->n)s+=p->x;return s;}
int main(void){a[0].n=a+1;a[1].n=a+2;printf("%d ",walk());a[0].n=a[1].n;a[1].n=0;printf("%d ",walk());a[1].x=8;a[1].n=head;head=a+1;printf("%d ",walk());return 0;}`},
 {id:'null-parent-partition',area:'terminal',stdout:'0 0 0 3 ',expect:{groups:[[0,1,2],[3]],terminal:'null'},source:io+String.raw`
typedef struct N{struct N*p;int x;}N;N a[4];
N*f(N*p){if(p->p==0)return p;return p->p=f(p->p);}
void join(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<4;i++)a[i].x=i;join(a,a+1);join(a+1,a+2);for(int i=0;i<4;i++)printf("%d ",f(a+i)->x);return 0;}`},
 {id:'sentinel-parent-partition',area:'terminal',stdout:'0 0 0 3 ',expect:{groups:[[0,1,2],[3]],sentinelExcluded:true},source:io+String.raw`
typedef struct N{struct N*p;int x;}N;N a[4],end;
N*f(N*p){if(p->p==&end)return p;return p->p=f(p->p);}
void join(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<4;i++){a[i].p=&end;a[i].x=i;}join(a,a+1);join(a+1,a+2);for(int i=0;i<4;i++)printf("%d ",f(a+i)->x);return 0;}`},
 {id:'sentinel-list-negative',area:'terminal',stdout:'6 ',expect:{notPartition:true,sentinelExcluded:true},source:io+String.raw`
typedef struct N{struct N*p;int x;}N;N a[3],end;
N*last(N*p){while(p->p!=&end)p=p->p;return p;}
int main(void){for(int i=0;i<3;i++){a[i].x=i+1;a[i].p=i==2?&end:a+i+1;}printf("%d ",a[0].x+a[1].x+last(a)->x);return 0;}`},
 {id:'pointer-comparator',area:'custom',stdout:'2:9 2:5 3:7 4:1 ',expect:{keyOrder:[[0,1],[4,-1]],pointerArguments:true},source:io+String.raw`
typedef struct {int k,t;}E;E a[8];int n;
int before(const E*x,const E*y){if(x->k!=y->k)return x->k<y->k;return x->t>y->t;}
void put(E x){int i=n++;a[i]=x;while(i){int p=(i-1)/2;if(!before(a+i,a+p))break;E t=a[i];a[i]=a[p];a[p]=t;i=p;}}
E take(void){E x=a[0];a[0]=a[--n];int i=0;while(i*2+1<n){int c=i*2+1;if(c+1<n&&before(a+c+1,a+c))c++;if(!before(a+c,a+i))break;E t=a[i];a[i]=a[c];a[c]=t;i=c;}return x;}
int main(void){put((E){4,1});put((E){2,5});put((E){3,7});put((E){2,9});while(n){E x=take();printf("%d:%d ",x.k,x.t);}return 0;}`},
 {id:'or-range',area:'custom',stdout:'15 11 ',expect:{coverage:[0,4],initial:15,final:11},source:io+String.raw`
int a[4]={1,2,4,8},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[i*2]|v[i*2+1];printf("%d ",v[1]);v[6]=0;for(int i=3;i;i/=2)v[i]=v[2*i]|v[2*i+1];printf("%d ",v[1]);return 0;}`},
 {id:'multiply-lazy',area:'custom',stdout:'60 6 24 ',expect:{sum:60,tag:6,leaf:24,clearedTag:1,applications:6},source:io+String.raw`
int a[4]={1,2,3,4},v[8],tag[8];
void apply(int k,int d){v[k]*=d;tag[k]*=d;}
void push(int k){if(tag[k]!=1){int d=tag[k];apply(k*2,d);apply(k*2+1,d);tag[k]=1;}}
int main(void){for(int i=0;i<8;i++)tag[i]=1;for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,2);apply(1,3);printf("%d %d ",v[1],tag[1]);push(1);push(3);printf("%d ",v[7]);return 0;}`},
 {id:'assign-lazy',area:'custom',stdout:'0 0 7 7 ',expect:{sum:0,firstTag:0,newValue:7,assignmentNotAccumulation:true},source:io+String.raw`
int a[4]={1,2,3,4},v[8],tag[8],valid[8];
void apply(int k,int l,int r,int d){v[k]=(r-l)*d;tag[k]=d;valid[k]=1;}
void push(int k,int l,int r){if(valid[k]){int d=tag[k],m=(l+r)/2;apply(k*2,l,m,d);apply(k*2+1,m,r,d);valid[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,0,4,0);printf("%d %d ",v[1],tag[1]);push(1,0,4);apply(3,2,4,7);push(3,2,4);printf("%d %d ",v[6],v[7]);return 0;}`},
 {id:'coupled-counters-negative',area:'custom',stdout:'15 6 ',expect:{notPropagation:true},source:io+String.raw`
int a[4]={1,2,3,4},v[8],stats[8];void update(int k,int d){v[k]+=d;stats[k]+=d;}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];update(1,5);update(2,6);stats[1]=0;printf("%d %d ",v[1],stats[2]);return 0;}`}
];
