#include <stdio.h>

typedef struct N{int count,leaf,key[3];struct N*child[4];}N;N store[128];int used=0;N*root;
N*make(int leaf){N*n=store+used++;*n=(N){0};n->leaf=leaf;return n;}
void split(N*p,int pos){N*y=p->child[pos],*z=make(y->leaf);z->count=1;z->key[0]=y->key[2];if(!y->leaf){z->child[0]=y->child[2];z->child[1]=y->child[3];y->child[2]=0;y->child[3]=0;}y->count=1;
for(int j=p->count;j>=pos+1;j--)p->child[j+1]=p->child[j];p->child[pos+1]=z;for(int j=p->count-1;j>=pos;j--)p->key[j+1]=p->key[j];p->key[pos]=y->key[1];p->count++;}
void nonfull(N*p,int x){int i=p->count-1;if(p->leaf){while(i>=0&&x<p->key[i]){p->key[i+1]=p->key[i];i--;}p->key[i+1]=x;p->count++;}else{while(i>=0&&x<p->key[i])i--;i++;if(p->child[i]->count==3){split(p,i);if(x>p->key[i])i++;}nonfull(p->child[i],x);}}
void insert(int x){if(root->count==3){N*p=make(0);p->child[0]=root;split(p,0);root=p;}nonfull(root,x);}
int sum(N*p){int s=0;for(int i=0;i<p->count;i++)s+=p->key[i];if(!p->leaf)for(int i=0;i<=p->count;i++)s+=sum(p->child[i]);return s;}
int count(N*p){int n=p->count;if(!p->leaf)for(int i=0;i<=p->count;i++)n+=count(p->child[i]);return n;}
int main(void){root=make(1);int input[31]={0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30};for(int i=0;i<31;i++)insert(input[i]);printf("%d %d %d\n",count(root),sum(root),root->count>0&&root->count<=3);return 0;}
