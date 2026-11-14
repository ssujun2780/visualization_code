#include <stdio.h>
typedef struct N{struct N*n;int v;}N;typedef struct{long cache;N nil;}Box;
int total(Box*b){int s=0;for(N*p=b->nil.n;p!=&b->nil;p=p->n)s+=p->v;return s;}
int main(void){Box box={0};N a[4]={{0}};box.nil.v=99;box.nil.n=a+1;a[1].v=a[3].v=5;a[1].n=a+3;a[3].n=&box.nil;
printf("S0 %d\n",total(&box));box.nil.n=&box.nil;printf("S1 %d\n",total(&box));return 0;}
