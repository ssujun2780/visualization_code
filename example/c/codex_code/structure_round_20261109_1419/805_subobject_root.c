#include <stdio.h>
#include <stdlib.h>

typedef struct N{int v;struct N*l,*r;}N;typedef struct{int marker;N nodes[6];}Arena;
int visit(N*p){return p?p->v+visit(p->l)+visit(p->r):0;}
int main(void){Arena a={0};a.nodes[2].v=4;a.nodes[3].v=2;a.nodes[4].v=6;a.nodes[2].l=a.nodes+3;a.nodes[2].r=a.nodes+4;N*root=&a.nodes[2];printf("%d\n",visit(root));return 0;}
