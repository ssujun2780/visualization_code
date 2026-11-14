#include <stdio.h>
#include <stdlib.h>

typedef struct N{int k;struct N*l,*r;}N;N a[3]={{3,0,0},{2,0,0},{1,0,0}};N*root=a;
int walk(N*p){return p?p->k+walk(p->l)+walk(p->r):0;}
void mark(void){printf("%d ",walk(root));}
int main(void){a[0].l=a+1;a[1].l=a+2;mark();N*p=root->l;root->l=p->r;mark();p->r=root;root=p;mark();N*part=root->r;root->r=0;mark();root->r=part;mark();return 0;}