#include <stdio.h>
#include <stdlib.h>
typedef struct N{int value;struct N*c,*b,*a;}N;int visit(N*p){if(!p)return 0;return p->value+visit(p->a)+visit(p->b)+visit(p->c);}
int main(void){N cells[4]={0};N*root=cells;for(int i=0;i<4;i++)cells[i].value=i+1;root->a=cells+1;root->b=cells+2;root->c=cells+3;for(int i=0;i<1;i++)printf("%d %d\n",i,visit(root));return 0;}
