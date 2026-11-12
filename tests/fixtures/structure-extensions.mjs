// Source-derived expectations, frozen by the audit before compilation.
export const extensionCases=[
 {id:'pointer-partition',group:'storage',stdout:'0 0 0 0 4 ',expect:{groups:[[0,1,2,3],[4]],rankOffset:8},source:String.raw`#include <stdio.h>
typedef struct N {struct N *p; int id, r;} N;N a[5];
N *find(N*x){if(x->p==x)return x;return x->p=find(x->p);}
void unite(N*x,N*y){x=find(x);y=find(y);if(x==y)return;if(x->r<y->r){N*t=x;x=y;y=t;}y->p=x;if(x->r==y->r)x->r++;}
int main(void){for(int i=0;i<5;i++){a[i].p=a+i;a[i].id=i;}unite(a,a+1);unite(a+2,a+3);unite(a,a+2);for(int i=0;i<5;i++)printf("%d ",find(a+i)->id);return 0;}`},
 {id:'pointer-heap',group:'storage',stdout:'2 2 4 7 ',expect:{heap:'min',count:4},source:String.raw`#include <stdio.h>
typedef struct N {int value;struct N*l,*r;}N;N a[4]={{4,0,0},{2,0,0},{7,0,0},{2,0,0}};N*root;
N*meld(N*x,N*y){if(!x)return y;if(!y)return x;if(x->value>y->value){N*t=x;x=y;y=t;}x->r=meld(x->r,y);N*t=x->l;x->l=x->r;x->r=t;return x;}
int main(void){for(int i=0;i<4;i++)root=meld(root,a+i);while(root){printf("%d ",root->value);root=meld(root->l,root->r);}return 0;}`},
 {id:'composite-heap',group:'comparison',stdout:'2:9 2:5 3:7 4:1 ',expect:{order:[[2,9],[2,5],[3,7],[4,1]]},source:String.raw`#include <stdio.h>
typedef struct {int k,t;} E;E a[8];int n;
int before(E x,E y){if(x.k!=y.k)return x.k<y.k;return x.t>y.t;}
void put(E x){int i=n++;a[i]=x;while(i){int p=(i-1)/2;if(!before(a[i],a[p]))break;E t=a[i];a[i]=a[p];a[p]=t;i=p;}}
E take(void){E out=a[0];a[0]=a[--n];int i=0;while(i*2+1<n){int c=i*2+1;if(c+1<n&&before(a[c+1],a[c]))c++;if(!before(a[c],a[i]))break;E t=a[i];a[i]=a[c];a[c]=t;i=c;}return out;}
int main(void){put((E){4,1});put((E){2,5});put((E){3,7});put((E){2,9});printf("%d:%d ",a[0].k,a[0].t);take();while(n){E e=take();printf("%d:%d ",e.k,e.t);}return 0;}`},
 {id:'height-role',group:'roles',stdout:'2 1 ',expect:{heightOffset:4,unrelatedOffset:8},source:String.raw`#include <stdio.h>
typedef struct N{int key,h,cache;struct N*l,*r;}N;N a[3]={{2,1,1,0,0},{1,1,1,0,0},{3,1,1,0,0}};N*root=a;
int height(N*p){if(!p)return 0;int x=height(p->l),y=height(p->r);p->h=(x>y?x:y)+1;return p->h;}
int main(void){a[0].l=a+1;a[0].r=a+2;printf("%d %d ",height(root),a[0].cache);return 0;}`},
 {id:'color-role',group:'roles',stdout:'17 17 17 ',expect:{colorOffset:4,unrelatedOffset:8},source:String.raw`#include <stdio.h>
typedef struct N{int key,c,flag;struct N*l,*r,*p;}N;N a[3]={{2,17,23,0,0,0},{1,23,17,0,0,0},{3,23,17,0,0,0}};N*root=a;
void fix(N*x){N*u=x->p->r;if(x->c==23&&u->c==23){x->c=17;u->c=17;x->p->c=23;}root->c=17;}
int visit(N*x){return x?1+visit(x->l)+visit(x->r):0;}
int main(void){a[0].l=a+1;a[0].r=a+2;a[1].p=a;a[2].p=a;fix(a+1);visit(root);printf("%d %d %d ",a[0].c,a[1].c,a[2].c);return 0;}`},
 {id:'role-negative',group:'roles',stdout:'3 ',expect:{noRoles:true},source:String.raw`#include <stdio.h>
typedef struct N{int a,b;struct N*l,*r;}N;N v[3]={{1,0,0,0},{2,1,0,0},{2,1,0,0}};
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){v[0].l=v+1;v[0].r=v+2;printf("%d ",visit(v));return 0;}`},
 {id:'range-min',group:'comparison',stdout:'-2 -7 ',expect:{initial:-2,final:-7,range:[0,4]},source:String.raw`#include <stdio.h>
int a[4]={3,-2,5,0},v[8];int choose(int x,int y){return x<y?x:y;}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=choose(v[2*i],v[2*i+1]);printf("%d ",v[1]);v[6]=-7;for(int i=3;i;i/=2)v[i]=choose(v[2*i],v[2*i+1]);printf("%d ",v[1]);return 0;}`},
 {id:'range-max-inline',group:'comparison',stdout:'8 ',expect:{final:8,range:[0,4]},source:String.raw`#include <stdio.h>
int a[4]={8,2,8,1},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--){int x=v[2*i],y=v[2*i+1];v[i]=x>y?x:y;}printf("%d ",v[1]);return 0;}`},
 {id:'range-lazy',group:'deferred',stdout:'30 5 9 ',expect:{sum:30,tag:5,leaf:9},source:String.raw`#include <stdio.h>
int a[4]={1,2,3,4},v[8],pending[8];
void apply(int k,int l,int r,int d){v[k]+=(r-l)*d;pending[k]+=d;}
void push(int k,int l,int r){int m=(l+r)/2;if(pending[k]){int x=pending[k];apply(k*2,l,m,x);apply(k*2+1,m,r,x);pending[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,0,4,5);printf("%d %d ",v[1],pending[1]);push(1,0,4);push(3,2,4);printf("%d ",v[7]);return 0;}`},
 {id:'persistent-tree',group:'sharing',stdout:'10 16 ',expect:{sharedLeaves:[0,2,3],old:10,new:16},source:String.raw`#include <stdio.h>
typedef struct N{int value;struct N*l,*r;}N;N pool[16];int used;N*old,*fresh;
N*build(int l,int r){N*p=pool+used++;if(r-l==1){p->value=l+1;return p;}int m=(l+r)/2;p->l=build(l,m);p->r=build(m,r);p->value=p->l->value+p->r->value;return p;}
N*change(N*p,int l,int r,int x,int v){N*q=pool+used++;*q=*p;if(r-l==1){q->value=v;return q;}int m=(l+r)/2;if(x<m)q->l=change(p->l,l,m,x,v);else q->r=change(p->r,m,r,x,v);q->value=q->l->value+q->r->value;return q;}
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){old=build(0,4);fresh=change(old,0,4,1,8);visit(old);visit(fresh);printf("%d %d ",old->value,fresh->value);return 0;}`},
 {id:'independent-trees',group:'sharing',stdout:'6 ',expect:{noShared:true},source:String.raw`#include <stdio.h>
typedef struct N{int v;struct N*l,*r;}N;N a[3],b[3];N*x=a,*y=b;
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){a[0].l=a+1;a[0].r=a+2;b[0].l=b+1;b[0].r=b+2;printf("%d ",visit(x)+visit(y));return 0;}`},
 {id:'selected-edges',group:'composition',stdout:'6 3 ',expect:{chosen:[0,1,2],weight:6,components:[[0,1,2,3]]},source:String.raw`#include <stdio.h>
typedef struct{int a,b,w;}E;E edges[5]={{0,1,1},{1,2,2},{2,3,3},{0,3,5},{0,2,7}},chosen[3];int parent[4],n;
int find(int x){if(parent[x]==x)return x;return parent[x]=find(parent[x]);}
int main(void){for(int i=0;i<4;i++)parent[i]=i;int sum=0;for(int i=0;i<5;i++){int a=find(edges[i].a),b=find(edges[i].b);if(a!=b){parent[b]=a;chosen[n++]=edges[i];sum+=edges[i].w;}}printf("%d %d ",sum,n);return 0;}`},
 {id:'equal-copy-negative',group:'composition',stdout:'6 ',expect:{noControlledSelection:true},source:String.raw`#include <stdio.h>
typedef struct{int a,b,w;}E;E edges[3]={{0,1,1},{1,2,2},{2,3,3}},copy[3];int p[4]={0,0,0,0};int main(void){int s=0;for(int i=0;i<3;i++){copy[i]=edges[i];s+=copy[i].w;}printf("%d ",s);return 0;}`},
];
