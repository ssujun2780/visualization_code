#include <stdio.h>
typedef struct{int a,b,w;}E;E edges[5]={{0,1,1},{1,2,2},{2,3,3},{0,3,5},{0,2,7}},chosen[3];int parent[4],n;
int find(int x){if(parent[x]==x)return x;return parent[x]=find(parent[x]);}
int main(void){for(int i=0;i<4;i++)parent[i]=i;int sum=0;for(int i=0;i<5;i++){int a=find(edges[i].a),b=find(edges[i].b);if(a!=b){parent[b]=a;chosen[n++]=edges[i];sum+=edges[i].w;}}printf("%d %d ",sum,n);return 0;}