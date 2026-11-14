#include <stdio.h>

typedef struct N{struct N*up;int v;struct N*hi,*memo,*lo;}N;typedef struct{int tag;N nil;N*root;}Box;
int visit(Box*b,N*p){return p==&b->nil?0:1+visit(b,p->lo)+visit(b,p->hi);}
int climb(Box*b,N*p){int n=0;while(p!=&b->nil){n++;p=p->up;}return n;}
int main(void){Box box={0};N a[4]={{0}};for(int i=0;i<4;i++){a[i].lo=a[i].hi=&box.nil;a[i].up=&box.nil;a[i].v=1;a[i].memo=a+3;}
box.nil.up=box.nil.lo=box.nil.hi=&box.nil;box.root=a+2;a[2].lo=a;a[2].hi=a+1;a[0].up=a+2;a[1].up=a+2;
printf("S0 %d\n",visit(&box,box.root)+climb(&box,a));a[0].up=a+1;
printf("S1 %d\n",visit(&box,box.root));a[0].up=a+2;printf("S2 %d\n",visit(&box,box.root));return 0;}
