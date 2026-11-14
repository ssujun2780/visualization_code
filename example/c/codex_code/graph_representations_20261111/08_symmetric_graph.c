#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

int has[V][V],weight[V][V];
void put(int u,int v,int w){has[u][v]=has[v][u]=1;weight[u][v]=weight[v][u]=w;}
int main(void){put(0,1,0);put(1,2,3);put(2,3,-1);for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int u=0;u<V;u++)for(int v=0;v<V;v++)if(has[u][v]){int w=weight[u][v];if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("P0 %d %d\n",count,sum);return 0;}
