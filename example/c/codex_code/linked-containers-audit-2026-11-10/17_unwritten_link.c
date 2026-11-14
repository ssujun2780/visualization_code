#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int scan(N*p){int s=0,k=0;while(p){s+=p->v;if(++k==2)break;p=p->n;}return s;}
int main(void){N a[3];a[0].v=1;a[0].n=a+1;a[1].v=1;a[2]=(N){8,0};N*head=a;
printf("S0 %d\n",scan(head));return 0;}
