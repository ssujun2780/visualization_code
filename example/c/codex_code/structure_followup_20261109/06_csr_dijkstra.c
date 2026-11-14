#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int edge(const int*a,int i){return a[i];}
int main(void){int offsets[6]={0,2,4,5,6,6},to[6]={1,2,2,3,3,4},cost[6]={2,9,1,4,1,1};int distance[5]={0,999,999,999,999},done[5]={0};
for(int step=0;step<5;step++){int u=-1;for(int v=0;v<5;v++)if(!done[v]&&(u<0||distance[v]<distance[u]))u=v;
done[u]=1;for(int e=offsets[u];e<offsets[u+1];e++){int v=edge(to,e);int alt=distance[u]+edge(cost,e);if(alt<distance[v])distance[v]=alt;}}
for(int i=0;i<5;i++)printf("%d%c",distance[i],i==4?'\n':' ');return 0;}
