#include <stdio.h>
#include <stdlib.h>

typedef struct N{int v;struct N*next;}N;void push(N**p,int x){N*n=malloc(sizeof(N));if(!n)exit(1);n->v=x;n->next=*p;*p=n;}
int main(void){N*root=0;push(&root,2);push(&root,3);push(&root,5);int sum=0;for(N*p=root;p;p=p->next)sum+=p->v;printf("%d\n",sum);while(root){N*p=root;root=root->next;free(p);}return 0;}
