#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int w[7][7]={{0,0,0,0,0,0,0},{0,0,1,3,0,0,0},{0,0,0,2,6,0,0},{0,0,0,0,3,2,0},{0,0,0,0,0,0,5},{0,0,0,0,0,0,1},{2,0,0,0,0,0,0}},present[7][7]={{0,1,1,0,0,0,0},{0,0,1,1,0,0,0},{0,0,0,1,1,0,0},{0,0,0,0,1,1,0},{0,0,0,0,0,1,1},{0,0,0,0,0,0,1},{1,0,0,0,0,0,0}};int d[7];for(int i=0;i<7;i++)d[i]=i?1000:0;for(int pass=0;pass<7;pass++)for(int u=0;u<7;u++)for(int v=0;v<7;v++)if(present[u][v]&&d[v]>d[u]+w[u][v])d[v]=d[u]+w[u][v];for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
