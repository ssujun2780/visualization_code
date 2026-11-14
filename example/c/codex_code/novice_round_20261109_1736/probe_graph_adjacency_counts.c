#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int to[4],weight[4],n,visited;}V;int main(void){V a[4]={0};a[0].to[0]=1;a[0].weight[0]=5;a[0].to[1]=2;a[0].weight[1]=7;a[0].n=2;a[1].to[0]=3;a[1].weight[0]=2;a[1].n=1;a[2].to[0]=3;a[2].weight[0]=1;a[2].n=1;int q[4]={0},r=0,w=1,sum=0;a[0].visited=1;while(r<w){int u=q[r++];for(int k=0;k<a[u].n;k++){int v=a[u].to[k];sum+=a[u].weight[k];if(!a[v].visited){a[v].visited=1;q[w++]=v;}}}printf("%d %d\n",w,sum);return 0;}
