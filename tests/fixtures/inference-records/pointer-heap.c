#include <stdio.h>
typedef struct N {int value;struct N*l,*r;}N;N a[4]={{4,0,0},{2,0,0},{7,0,0},{2,0,0}};N*root;
N*meld(N*x,N*y){if(!x)return y;if(!y)return x;if(x->value>y->value){N*t=x;x=y;y=t;}x->r=meld(x->r,y);N*t=x->l;x->l=x->r;x->r=t;return x;}
int main(void){for(int i=0;i<4;i++)root=meld(root,a+i);while(root){printf("%d ",root->value);root=meld(root->l,root->r);}return 0;}