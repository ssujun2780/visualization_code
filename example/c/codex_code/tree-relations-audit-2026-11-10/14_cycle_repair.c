#include <stdio.h>

typedef struct N{int v;struct N*lo,*hi;}N;
int walk(N*p,int d){return !p||!d?0:1+walk(p->lo,d-1)+walk(p->hi,d-1);}
int main(void){N a[3]={{0}};a[1].lo=a;a[1].hi=a+2;a[2].lo=a+1;N*root=a+1;
printf("S0 %d\n",walk(root,3));a[2].lo=0;printf("S1 %d\n",walk(root,3));return 0;}
