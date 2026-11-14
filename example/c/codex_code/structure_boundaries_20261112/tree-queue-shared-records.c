#include <stdio.h>
#include <stdlib.h>

typedef struct N{int x;struct N*l,*r,*q;}N;N a[3]={{3,0,0,0},{1,0,0,0},{2,0,0,0}};N*root=a,*front,*back;
int tree(N*p){return p?p->x+tree(p->l)+tree(p->r):0;}
void put(N*p){if(back)back->q=p;else front=p;back=p;}
int main(void){a[0].l=a+1;a[0].r=a+2;put(a);put(a+1);put(a+2);printf("%d ",tree(root));int n=0;while(front){N*p=front;front=p->q;n+=p->x;}back=0;printf("%d ",n);return 0;}