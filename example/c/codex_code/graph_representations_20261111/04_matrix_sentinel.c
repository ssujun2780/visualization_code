#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

int grid[V][V];
void put(int u,int v,int w){grid[u][v]=w;}
void scan(const char*tag){for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int u=0;u<V;u++)for(int v=0;v<V;v++)if(grid[u][v]!=99999){int w=grid[u][v];if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("%s %d %d\n",tag,count,sum);}
int main(void){for(int u=0;u<V;u++)for(int v=0;v<V;v++)grid[u][v]=99999;put(0,1,0);put(0,2,4);put(1,3,-2);put(2,3,7);put(3,3,5);scan("P0");grid[0][2]=99999;put(4,2,9);scan("P1");return 0;}
