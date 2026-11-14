#include <stdio.h>
typedef struct N{struct N*n;int v;}N;
int sum(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int main(void){N a[6]={{0}};for(int i=0;i<6;i++)a[i].v=2;a[4].n=a+1;a[1].n=a+5;a[5].n=a;
N*head=a+4;printf("S0 %d\n",sum(head));N*old=0,*p=head;while(p){N*t=p->n;p->n=old;old=p;p=t;}head=old;
printf("S1 %d\n",sum(head));N*other=head->n->n;head->n->n=0;printf("S2 %d %d\n",sum(head),sum(other));
head->n->n=other;other=0;printf("S3 %d %d\n",sum(head),sum(other));return 0;}
