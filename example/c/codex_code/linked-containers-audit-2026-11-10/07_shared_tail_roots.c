#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int scan(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int main(void){N a[6]={{0}};for(int i=0;i<6;i++)a[i].v=1;a[4].n=a+2;a[3].n=a+2;a[2].n=a;
N*roots[2]={a+4,a+3};printf("S0 %d\n",scan(roots[0])+scan(roots[1]));a[2].n=a+5;
printf("S1 %d\n",scan(roots[0])+scan(roots[1]));return 0;}
