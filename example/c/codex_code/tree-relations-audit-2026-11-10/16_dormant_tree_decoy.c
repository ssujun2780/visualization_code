#include <stdio.h>
typedef struct N{int v;struct N*lo,*hi;}N;
int visit(N*p){return p?1+visit(p->lo)+visit(p->hi):0;}
int main(void){N a[3]={{2,0,0},{2,0,0},{2,0,0}};a[0].lo=a+1;a[0].hi=a+2;N*table[3]={a+2,a,a+2};
int sum=0;for(int i=0;i<3;i++)sum+=table[i]->v;printf("S0 %d\n",sum);return 0;}
