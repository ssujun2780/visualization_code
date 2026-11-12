#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int scan(N*p,int bound){int s=0;while(p&&bound--){s+=p->v;p=p->n;}return s;}
int main(void){N a={7,0};N*head=&a;printf("S0 %d\n",scan(head,4));head=0;printf("S1 %d\n",scan(head,4));
head=&a;a.n=&a;printf("S2 %d\n",scan(head,4));return 0;}
