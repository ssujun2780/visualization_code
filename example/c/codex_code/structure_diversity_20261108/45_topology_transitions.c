#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*a,*b;}N;
int bounded(N*p){int s=0;for(int i=0;i<3&&p;i++){s+=p->v;p=p->a;}return s;}
int main(void){N n[3]={{1,0,0},{2,0,0},{3,0,0}};N*root=n;n[0].a=&n[1];n[0].b=&n[2];int out=bounded(root);
 n[1].b=&n[2];out+=bounded(root);n[2].a=root;out+=bounded(root);n[2].a=0;n[1].b=0;out+=bounded(root);printf("%d\n",out);return 0;}
