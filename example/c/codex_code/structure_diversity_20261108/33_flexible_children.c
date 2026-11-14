#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int value,count;struct N*child[];}N;
int main(void){N*root=calloc(1,sizeof*root+3*sizeof(N*));if(!root)return 1;root->value=1;root->count=3;
 for(int i=0;i<3;i++){root->child[i]=calloc(1,sizeof(N));if(!root->child[i]){for(int j=0;j<i;j++)free(root->child[j]);free(root);return 1;}root->child[i]->value=i+2;}
 int sum=root->value;for(int i=0;i<root->count;i++)sum+=root->child[i]->value;printf("%d\n",sum);
 for(int i=0;i<root->count;i++)free(root->child[i]);free(root);return 0;}
