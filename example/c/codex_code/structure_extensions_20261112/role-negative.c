#include <stdio.h>
typedef struct N{int a,b;struct N*l,*r;}N;N v[3]={{1,0,0,0},{2,1,0,0},{2,1,0,0}};
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){v[0].l=v+1;v[0].r=v+2;printf("%d ",visit(v));return 0;}