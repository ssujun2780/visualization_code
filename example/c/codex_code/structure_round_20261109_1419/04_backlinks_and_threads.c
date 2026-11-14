#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*l,*r,*up,*thread;}N;
int walk(N*p){if(!p)return 0;return walk(p->l)+p->v+walk(p->r);}
int main(void){N n[3]={{2,0,0,0,0},{1,0,0,0,0},{3,0,0,0,0}};N*root=n;
n[0].l=n+1;n[0].r=n+2;n[1].up=n;n[2].up=n;n[1].thread=n;n[0].thread=n+2;
int s=0;for(N*p=n+1;p;p=p->thread)s+=p->v;
printf("%d %d %d\n",walk(root),s,n[2].up->v);return 0;}
