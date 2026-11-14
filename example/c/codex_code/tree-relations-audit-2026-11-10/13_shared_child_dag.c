#include <stdio.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
int main(void){N a[5]={{0}};a[3].lo=a+1;a[3].hi=a+4;a[1].hi=a;a[4].lo=a;N*root=a+3;
printf("S0 %d\n",visit(root));return 0;}
