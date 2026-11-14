#include <stdio.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
int main(void){N a[3];a[0].v=a[1].v=a[2].v=1;a[0].lo=a+2;a[2].lo=a+1;a[1].lo=0;N*root=a;
int n=0;for(N*p=root;p;p=p->lo)n+=p->v;printf("S0 %d\n",n);return 0;}
