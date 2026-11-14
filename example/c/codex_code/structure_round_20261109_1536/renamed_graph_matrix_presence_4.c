#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int X9d144c0234[4][4]={{0,0,0,0},{0,0,1,3},{0,0,0,2},{3,0,0,0}},Xe3fae4ef6e[4][4]={{0,1,1,0},{0,0,1,1},{0,0,0,1},{1,0,0,0}};int X77863ed7a1[4];for(int i=0;i<4;i++)X77863ed7a1[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int u=0;u<4;u++)for(int v=0;v<4;v++)if(Xe3fae4ef6e[u][v]&&X77863ed7a1[v]>X77863ed7a1[u]+X9d144c0234[u][v])X77863ed7a1[v]=X77863ed7a1[u]+X9d144c0234[u][v];for(int i=0;i<4;i++)printf("%d ",X77863ed7a1[i]);printf("\n");return 0;}
