#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*child,*sibling;}N;
int walk(N*p){if(!p)return 0;return p->v+walk(p->child)+walk(p->sibling);}
int main(void){N n[5]={{1,0,0},{2,0,0},{3,0,0},{4,0,0},{5,0,0}};N*root=n;
n[0].child=n+1;n[1].sibling=n+2;n[2].sibling=n+3;n[1].child=n+4;
printf("%d\n",walk(root));return 0;}
