#include <stdio.h>
typedef struct N{int v;struct N*n;}N;
int scan(N*p){int s=0;while(p){s+=p->v;p=p->n;}return s;}
int main(void){N a[6]={{0}};for(int i=0;i<6;i++)a[i].v=1;a[1].n=a;a[4].n=a+3;
N*roots[2]={a+1,a+4};printf("S0 %d %d\n",scan(roots[0]),scan(roots[1]));return 0;}
