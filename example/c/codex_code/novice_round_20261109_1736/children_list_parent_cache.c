#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*child,*sibling,*parent;int count;}N;
int sum(N*p){int s=p->v;for(N*q=p->child;q;q=q->sibling)s+=sum(q);return s;}
int main(void){N a[6]={0};for(int i=0;i<6;i++)a[i].v=i+1;a[0].child=a+1;a[1].sibling=a+2;a[2].sibling=a+3;a[1].child=a+4;a[4].sibling=a+5;for(int i=1;i<=3;i++)a[i].parent=a;for(int i=4;i<6;i++)a[i].parent=a+1;a[0].count=3;a[1].count=2;N*root=a;printf("%d %d\n",sum(root),root->count);return 0;}
