#include <stdio.h>

typedef struct N{int used,v;struct N*child[4];}N;
int walk(N*p){int n=1;for(int j=0;j<p->used;j++)n+=walk(p->child[j]);return n;}
int main(void){N a[7]={{0}};for(int i=0;i<7;i++)a[i].v=3;
a[4].used=3;a[4].child[0]=a+1;a[4].child[1]=a+5;a[4].child[2]=a+2;a[4].child[3]=a+6;
a[1].used=1;a[1].child[0]=a;a[1].child[2]=a+4;N*root=a+4;
printf("S0 %d\n",walk(root));a[4].used=2;printf("S1 %d\n",walk(root));return 0;}
