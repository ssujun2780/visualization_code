#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int main(void){N a[4]={{3,0},{3,0},{3,0},{3,0}};a[0].n=a+1;a[1].n=a+2;a[2].n=a+3;
N*table[3]={a+3,a+1,a+3};int s=0;for(int i=0;i<3;i++)s+=table[i]->v;printf("S0 %d\n",s);return 0;}
