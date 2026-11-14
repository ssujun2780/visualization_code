#include <stdio.h>
typedef struct N{int v;struct N*l,*r;}N;N a[3],b[3];N*x=a,*y=b;
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){a[0].l=a+1;a[0].r=a+2;b[0].l=b+1;b[0].r=b+2;printf("%d ",visit(x)+visit(y));return 0;}