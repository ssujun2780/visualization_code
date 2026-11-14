#include <stdio.h>
#include <stdlib.h>

typedef struct N{int v;struct N*l,*r;}N;int visit(N*p){return p?p->v+visit(p->l)+visit(p->r):0;}
int main(void){N pool[12]={0};pool[0].v=4;pool[1].v=2;pool[2].v=6;pool[0].l=pool+1;pool[0].r=pool+2;N*root=pool;printf("%d\n",visit(root));return 0;}
