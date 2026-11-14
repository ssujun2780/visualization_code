#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*l,*r;}N;int main(void){N*root=0;printf("empty %d\n",root==0);root=calloc(1,sizeof(N));if(!root)return 1;root->v=4;printf("single %d\n",root->v);
root->l=calloc(1,sizeof(N));if(!root->l)return 1;root->l->v=7;printf("tree %d\n",root->v+root->l->v);free(root->l);root->l=0;free(root);root=0;printf("freed %d\n",root==0);return 0;}
