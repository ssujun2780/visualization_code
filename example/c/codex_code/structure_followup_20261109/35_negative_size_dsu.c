#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int parent[8];
int root(int x){if(parent[x]<0)return x;return parent[x]=root(parent[x]);}
void join(int a,int b){a=root(a);b=root(b);if(a==b)return;if(parent[a]>parent[b]){int t=a;a=b;b=t;}parent[a]+=parent[b];parent[b]=a;}
int main(void){for(int i=0;i<8;i++)parent[i]=-1;join(0,1);join(2,3);join(1,2);join(5,6);int count=0;for(int i=0;i<8;i++)if(parent[i]<0)count++;printf("%d %d %d\n",count,root(3),-parent[root(0)]);return 0;}
