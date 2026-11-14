#include <stdio.h>
#include <stdlib.h>
typedef struct N {int value;struct N *left,*right;} N;
int sum(N*p){if(!p)return 0;int a=sum(p->left);int b=sum(p->right);return p->value+a+b;}
int main(void){N a[5]={{.value=1},{.value=2},{.value=3},{.value=4},{.value=5}};
a[0].left=&a[1];a[0].right=&a[2];a[1].left=&a[3];a[1].right=&a[4];N*root=&a[0];

printf("%d\n",sum(root));return 0;}