#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int parent[8],size[8];int root(int x){while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
void join(int a,int b){a=root(a);b=root(b);if(a==b)return;if(size[a]<size[b]){int t=a;a=b;b=t;}parent[b]=a;size[a]+=size[b];}
int main(void){for(int i=0;i<8;i++){parent[i]=i;size[i]=1;}join(0,1);join(2,3);join(1,2);join(5,6);int count=0;for(int i=0;i<8;i++)if(root(i)==i)count++;
printf("%d %d %d\n",count,root(3),size[root(0)]);return 0;}
