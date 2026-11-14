#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int from[18]={0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,9},to[18]={1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,0},cost[18]={0,0,1,3,2,6,3,2,0,5,1,1,2,4,3,0,0,1};int d[10];for(int i=0;i<10;i++)d[i]=i?1000:0;for(int pass=0;pass<10;pass++)for(int k=0;k<18;k++)if(d[to[k]]>d[from[k]]+cost[k])d[to[k]]=d[from[k]]+cost[k];for(int i=0;i<10;i++)printf("%d ",d[i]);printf("\n");return 0;}
