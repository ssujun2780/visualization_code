#include <stdio.h>
typedef struct N{struct N*back;int v;struct N*n;}N;
int scan(N*p,int reverse){int s=0;while(p){s+=p->v;p=reverse?p->back:p->n;}return s;}
int main(void){N a[4]={{0}};for(int i=0;i<4;i++)a[i].v=2;a[2].n=a;a[0].back=a+2;a[0].n=a+3;a[3].back=a;
N*head=a+2,*tail=a+3;printf("S0 %d\n",scan(head,0)+scan(tail,1));a[2].n=a+3;
printf("S1 %d\n",scan(head,0));a[3].back=a+2;a[0].n=0;a[0].back=0;printf("S2 %d\n",scan(head,0)+scan(tail,1));return 0;}
