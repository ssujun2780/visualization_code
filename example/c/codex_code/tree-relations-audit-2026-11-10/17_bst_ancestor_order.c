#include <stdio.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
int find(N*p,int key){while(p){if(key==p->v)return 1;p=key<p->v?p->lo:p->hi;}return 0;}
int main(void){N a[4]={{10,0,0},{5,0,0},{15,0,0},{7,0,0}};a[0].lo=a+1;a[0].hi=a+2;a[1].hi=a+3;N*root=a;
printf("S0 %d\n",visit(root)+find(root,7));a[3].v=12;printf("S1 %d\n",visit(root)+find(root,12));return 0;}
