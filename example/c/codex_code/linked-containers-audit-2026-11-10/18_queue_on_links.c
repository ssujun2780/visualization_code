#include <stdio.h>
typedef struct N{struct N*n;int v;}N;
void add(N**h,N**t,N*p){p->n=0;if(*t)(*t)->n=p;else *h=p;*t=p;}
N*take(N**h,N**t){N*p=*h;if(p){*h=p->n;if(!*h)*t=0;}return p;}
int sum(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int main(void){N a[5]={{0,4},{0,4},{0,4},{0,4},{0,4}};N*head=0,*tail=0;
add(&head,&tail,a+3);add(&head,&tail,a+1);add(&head,&tail,a+4);N*x=take(&head,&tail);add(&head,&tail,a);
printf("S0 %d %d\n",x->v,sum(head));return 0;}
