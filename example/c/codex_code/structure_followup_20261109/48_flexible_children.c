#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct N{int value,count;struct N*child[];}N;
N*make(int v,int count){N*p=calloc(1,sizeof *p+(size_t)count*sizeof p->child[0]);if(!p)exit(1);p->value=v;p->count=count;return p;}
int sum(N*p){int s=p->value;for(int i=0;i<p->count;i++)s+=sum(p->child[i]);return s;}
void clear(N*p){for(int i=0;i<p->count;i++)clear(p->child[i]);free(p);}
int main(void){N*root=make(1,2);root->child[0]=make(2,0);root->child[1]=make(3,0);printf("%d\n",sum(root));clear(root);return 0;}
