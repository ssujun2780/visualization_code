#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*l,*r;}N;int main(void){{N n[4]={{1,0,0},{2,0,0},{3,0,0},{4,0,0}};n[0].l=n+1;n[0].r=n+2;n[1].r=n+3;N*root=n;int s=0;
for(N*p=root;p;p=p->l)s+=p->v;printf("%d\n",s);return 0;}}
