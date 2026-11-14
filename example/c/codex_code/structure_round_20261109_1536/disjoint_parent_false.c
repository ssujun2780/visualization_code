#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

int parent[7]={-1,-1,-1,-1,-1,-1,-1};
int root(int x){while(parent[x]>=0)x=parent[x];return x;}
void join(int a,int b){a=root(a);b=root(b);if(a!=b)parent[b]=a;}
int main(void){join(0,1);join(1,2);join(4,5);join(5,6);
 int sum=0;for(int i=0;i<7;i++)sum+=root(i);printf("%d\n",sum);return 0;
}
