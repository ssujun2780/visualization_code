#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*l,*r,*parent;}N;int sum(N*p){return p?p->x+sum(p->l)+sum(p->r):0;}
int main(void){N a[4]={0};for(int i=0;i<4;i++)a[i].x=i+1;a[0].l=a+1;a[0].r=a+2;a[1].l=a+3;a[1].parent=a;a[2].parent=a;a[3].parent=a+1;N*root=a,*saved=a+1;printf("%d\n",sum(root));root->l=0;printf("%d %d\n",sum(root),sum(saved));return 0;}
