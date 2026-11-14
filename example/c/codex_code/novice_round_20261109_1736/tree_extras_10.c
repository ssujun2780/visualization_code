#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct T{int value;struct T*l,*r;struct T*parent;}T;
int sum(T*p){if(!p)return 0;return p->value+sum(p->l)+sum(p->r);}
int main(void){T pool[5]={0};int values[5]={7,2,11,9,1};for(int i=0;i<5;i++){pool[i].value=values[i];}
pool[0].l=pool+1;pool[0].r=pool+2;pool[1].l=pool+3;pool[1].r=pool+4;
pool[1].parent=pool;pool[2].parent=pool;pool[3].parent=pool+1;pool[4].parent=pool+1;T*q=pool+4;int depth=0;while(q->parent){depth++;q=q->parent;}
T*root=pool;int s=sum(root);
printf("%d %d\n",s,depth);return 0;}
