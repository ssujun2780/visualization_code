#include <stdio.h>

typedef struct N{int v;struct N*child,*sibling;}N;
int walk(N*p){int n=1;for(N*q=p->child;q;q=q->sibling)n+=walk(q);return n;}
int main(void){N a[7]={{0}};for(int i=0;i<7;i++)a[i].v=4;
a[4].child=a+2;a[2].sibling=a+6;a[6].sibling=a+1;a[2].child=a+5;a[6].child=a;a[0].sibling=a+3;
N*root=a+4;printf("S0 %d\n",walk(root));return 0;}
