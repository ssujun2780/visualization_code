#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*a,*b;}N;
int sum(N*p){if(!p)return 0;return p->v+sum(p->a)+sum(p->b);}
int main(void){int mode;if(scanf("%d",&mode)!=1)return 1;N n[3]={{1,0,0},{2,0,0},{3,0,0}};N*root=n;n[0].a=&n[1];if(mode)n[0].b=&n[2];else n[1].a=&n[2];printf("%d\n",sum(root));return 0;}
