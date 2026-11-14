#include <stdio.h>
#include <stdlib.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
N*make(void){N*p=calloc(1,sizeof *p);if(!p)exit(2);p->v=1;return p;}
int main(void){N*a=make(),*b=make(),*c=make(),*d=make();N*root=a;a->lo=b;a->hi=c;b->hi=d;
printf("S0 %d\n",visit(root));a->lo=d;free(b);printf("S1 %d\n",visit(root));
a->hi=0;free(c);printf("S2 %d\n",visit(root));free(d);free(a);return 0;}
