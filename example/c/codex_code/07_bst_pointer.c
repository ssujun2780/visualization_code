#include <stdio.h>
#include <stdlib.h>
typedef struct N{struct N*left,*right;int key;} N;
static int insert(N**root,int value){while(*root){root=value<(*root)->key?&(*root)->left:&(*root)->right;}N*n=calloc(1,sizeof*n);if(!n)return 0;n->key=value;*root=n;return 1;}
static void visit(N*n,int*out,int*size){if(!n)return;visit(n->left,out,size);out[(*size)++]=n->key;visit(n->right,out,size);}
static void release(N*n){if(!n)return;release(n->left);release(n->right);free(n);}
int main(void){int n,out[32],size=0;N*root=NULL;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!insert(&root,x)){release(root);return 1;}}
 visit(root,out,&size);for(int i=0;i<size;i++)printf("%d%c",out[i],i+1==size?'\n':' ');release(root);return 0;}
