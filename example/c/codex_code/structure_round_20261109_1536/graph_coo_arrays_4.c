#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int from[6]={0,0,1,1,2,3},to[6]={1,2,2,3,3,0},cost[6]={0,0,1,3,2,3};int d[4];for(int i=0;i<4;i++)d[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int k=0;k<6;k++)if(d[to[k]]>d[from[k]]+cost[k])d[to[k]]=d[from[k]]+cost[k];for(int i=0;i<4;i++)printf("%d ",d[i]);printf("\n");return 0;}
