#include <stdio.h>
typedef struct N{int key,c,flag;struct N*l,*r,*p;}N;N a[3]={{2,17,23,0,0,0},{1,23,17,0,0,0},{3,23,17,0,0,0}};N*root=a;
void fix(N*x){N*u=x->p->r;if(x->c==23&&u->c==23){x->c=17;u->c=17;x->p->c=23;}root->c=17;}
int visit(N*x){return x?1+visit(x->l)+visit(x->r):0;}
int main(void){a[0].l=a+1;a[0].r=a+2;a[1].p=a;a[2].p=a;fix(a+1);visit(root);printf("%d %d %d ",a[0].c,a[1].c,a[2].c);return 0;}