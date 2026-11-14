#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int raw[4][4]={{0,1,1,0},{0,0,0,1},{0,0,0,1},{1,0,0,0}},*rows[4],visited[4]={1,0,0,0},parent[4]={-1,-1,-1,-1},queue[4]={0},h=0,t=1;for(int i=0;i<4;i++)rows[i]=raw[i];while(h<t){int u=queue[h++];for(int v=0;v<4;v++)if(rows[u][v]&&!visited[v]){visited[v]=1;parent[v]=u;queue[t++]=v;}}int depth=0;for(int k=3;parent[k]>=0;k=parent[k])depth++;printf("%d %d\n",t,depth);return 0;}
