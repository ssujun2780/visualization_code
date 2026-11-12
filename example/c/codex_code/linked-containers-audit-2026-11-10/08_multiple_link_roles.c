#include <stdio.h>
typedef struct N{struct N*other;int v;struct N*n;}N;
int scanA(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int scanB(N*p){int s=0;while(p){s+=p->v;p=p->other;}return s;}
int main(void){N a[5]={{0}};for(int i=0;i<5;i++)a[i].v=4;a[0].n=a+3;a[3].n=a+1;a[0].other=a+4;a[4].other=a+2;
N*head=a;printf("S0 %d %d\n",scanA(head),scanB(head));return 0;}
