#include <stdio.h>

typedef struct E{int to,weight,from;}E;
E edges[6]={{1,4,0},{2,1,0},{2,2,1},{3,1,1},{3,5,2},{4,3,3}};
int parent[5],sizes[5],used[6],chosen[4];
int root(int x){while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
int main(void){for(int i=0;i<5;i++){parent[i]=i;sizes[i]=1;}int n=0,sum=0;
for(int turn=0;turn<6;turn++){int best=-1;for(int k=0;k<6;k++)if(!used[k]&&(best<0||edges[k].weight<edges[best].weight))best=k;
used[best]=1;int a=root(edges[best].from),b=root(edges[best].to);if(a!=b){if(sizes[a]<sizes[b]){int tmp=a;a=b;b=tmp;}parent[b]=a;sizes[a]+=sizes[b];chosen[n++]=best;sum+=edges[best].weight;}}
printf("B %d %d %d %d %d %d\n",n,sum,chosen[0],chosen[1],chosen[2],chosen[3]);return 0;}
