#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct T{int value;struct T*l,*r;int size,mark;struct T*owner;}T;
int sum(T*p){if(!p)return 0;return p->value+sum(p->l)+sum(p->r);}
int main(void){T pool[5]={0};int values[5]={7,2,11,9,1};for(int i=0;i<5;i++){pool[i].value=values[i];pool[i].size=99;pool[i].mark=i%2;pool[i].owner=pool;}
pool[0].l=pool+1;pool[0].r=pool+2;pool[1].l=pool+3;pool[1].r=pool+4;

T*root=pool;int s=sum(root);int marks=0;for(int i=0;i<5;i++)marks+=pool[i].mark+(pool[i].owner==root);
printf("%d %d %d\n",s,marks,root->size);return 0;}
