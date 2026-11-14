#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*l,*r,*order;}N;
int sum(N*p){return p?p->v+sum(p->l)+sum(p->r):0;}
int main(void){N n[5]={0};for(int i=0;i<5;i++){n[i].v=i+1;if(i<4)n[i].order=&n[i+1];}n[0].l=&n[1];n[0].r=&n[2];n[1].l=&n[3];n[1].r=&n[4];
 N*root=n;int count=0;for(N*p=root;p;p=p->order)count++;printf("%d %d\n",sum(root),count);return 0;}

