#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key;struct N*l,*r;}N;
int sum(N*p){return p?p->key+sum(p->l)+sum(p->r):0;}
int main(void){N a[5]={0};N*root=0;for(int i=0;i<5;i++){a[i].key=i+1;N**q=&root;while(*q){if(a[i].key<(*q)->key)q=&(*q)->l;else q=&(*q)->r;}*q=a+i;}printf("%d\n",sum(root));return 0;}
