#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int around(N*h){int s=0;N*p=h;if(p)do{s+=p->v;p=p->n;}while(p!=h);return s;}
int linear(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int main(void){N a[4]={{0}};a[3].v=a[0].v=a[2].v=3;a[3].n=a;a[0].n=a+2;a[2].n=a+3;N*head=a+3;
printf("S0 %d\n",around(head));a[2].n=0;printf("S1 %d\n",linear(head));return 0;}
