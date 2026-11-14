#include <stdio.h>

typedef struct N{int v;struct N*up;}N;
int depth(N*p){int n=0;while(p){n++;p=p->up;}return n;}
int main(void){N a[6]={{0}};for(int i=0;i<6;i++)a[i].v=1;a[0].up=a+3;a[1].up=a+3;a[2].up=a;a[4].up=a;a[5].up=a+1;
N*root=a+3;int n=0;for(int i=0;i<6;i++)n+=depth(a+i);printf("S0 %d\n",n+root->v);return 0;}
