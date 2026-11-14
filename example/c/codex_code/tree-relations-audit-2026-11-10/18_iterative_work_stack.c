#include <stdio.h>

typedef struct N{struct N*hi;int v;struct N*lo;}N;
int main(void){N a[6]={{0}};a[4].lo=a+1;a[4].hi=a+3;a[1].hi=a;N*root=a+4;N*work[12];int top=0,n=0;work[top++]=root;
while(top){N*p=work[--top];n++;if(p->hi)work[top++]=p->hi;if(p->lo)work[top++]=p->lo;}
printf("S0 %d\n",n);return 0;}
