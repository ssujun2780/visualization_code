#include <stdio.h>
typedef struct N{int key,status,flag;struct N*l,*r,*p;}N;N a[3]={{2,101,203,0,0,0},{1,203,101,0,0,0},{3,203,101,0,0,0}};N*root=a;
void fix(N*x){N*u=x->p->r;if(x->status==203&&u->status==203){x->status=101;u->status=101;x->p->status=203;}root->status=101;}
int visit(N*x){return x?1+visit(x->l)+visit(x->r):0;}
int main(void){a[0].l=a+1;a[0].r=a+2;a[1].p=a;a[2].p=a;fix(a+1);visit(root);printf("%d %d %d ",a[0].status,a[1].status,a[2].status);return 0;}