#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int w[4][4]={{0,0,0,0},{0,0,1,3},{0,0,0,2},{3,0,0,0}},present[4][4]={{0,1,1,0},{0,0,1,1},{0,0,0,1},{1,0,0,0}};int d[4];for(int i=0;i<4;i++)d[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int u=0;u<4;u++)for(int v=0;v<4;v++)if(present[u][v]&&d[v]>d[u]+w[u][v])d[v]=d[u]+w[u][v];for(int i=0;i<4;i++)printf("%d ",d[i]);printf("\n");return 0;}
