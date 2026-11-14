#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int off[5]={0,2,4,5,5},to[5]={1,2,2,3,3},cost[5]={0,5,2,9,1};
int main(void){int dist[4]={0,100,100,100};for(int rep=0;rep<4;rep++)for(int u=0;u<4;u++)
for(int k=off[u];k<off[u+1];k++)if(dist[to[k]]>dist[u]+cost[k])dist[to[k]]=dist[u]+cost[k];
printf("%d %d %d %d\n",dist[0],dist[1],dist[2],dist[3]);return 0;}
