#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*l,*r;}N;int sum(N*p){return p?p->x+sum(p->l)+sum(p->r):0;}
int main(void){N a[3]={{1,0,0},{7,0,0},{7,0,0}};a[0].l=a+1;a[0].r=a+2;N*root=a;printf("%d\n",sum(root));return 0;}
