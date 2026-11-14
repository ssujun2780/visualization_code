#include <stdio.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
int main(void){N a[8]={{0}};for(int i=0;i<8;i++)a[i].v=2;
a[4].lo=a+1;a[4].hi=a+6;a[1].lo=a;a[1].hi=a+3;a[6].lo=a+5;a[6].hi=a+2;
N*root=a+4;printf("S0 %d\n",visit(root));N*x=root,*y=x->hi;x->hi=y->lo;y->lo=x;root=y;
printf("S1 %d\n",visit(root));return 0;}
