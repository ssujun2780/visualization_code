#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int g[5][5]={{0,2,7,99,99},{99,0,1,4,99},{99,99,0,1,7},{99,99,99,0,3},{99,99,99,99,0}},d[5]={0,99,99,99,99},used[5]={0};
for(int step=0;step<5;step++){int u=-1;for(int v=0;v<5;v++)if(!used[v]&&(u<0||d[v]<d[u]))u=v;int again=-1;for(int v=0;v<5;v++)if(!used[v]&&(again<0||d[v]<d[again]))again=v;u=again;used[u]=1;for(int v=0;v<5;v++)if(!used[v]&&g[u][v]<99&&d[u]+g[u][v]<d[v])d[v]=d[u]+g[u][v];}
for(int v=0;v<5;v++)printf("%d ",d[v]);puts("");return 0;}
