#include <stdio.h>
typedef struct {int key,left,right;} Node;
static Node arena[32];static int used=0;
static int insert(int root,int key){if(root<0){int p=used++;arena[p]=(Node){key,-1,-1};return p;}
 if(key<arena[root].key)arena[root].left=insert(arena[root].left,key);
 else {arena[root].right=insert(arena[root].right,key);}
 return root;}
static void inorder(int root,int*out,int*count){if(root<0)return;inorder(arena[root].left,out,count);out[(*count)++]=arena[root].key;inorder(arena[root].right,out,count);}
int main(void){int n,root=-1,out[32],count=0;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1)return 1;root=insert(root,x);}
 inorder(root,out,&count);for(int i=0;i<count;i++)printf("%d%c",out[i],i+1==count?'\n':' ');return 0;}
