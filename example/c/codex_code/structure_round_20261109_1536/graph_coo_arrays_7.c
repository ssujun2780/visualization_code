#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int from[12]={0,0,1,1,2,2,3,3,4,4,5,6},to[12]={1,2,2,3,3,4,4,5,5,6,6,0},cost[12]={0,0,1,3,2,6,3,2,0,5,1,2};int d[7];for(int i=0;i<7;i++)d[i]=i?1000:0;for(int pass=0;pass<7;pass++)for(int k=0;k<12;k++)if(d[to[k]]>d[from[k]]+cost[k])d[to[k]]=d[from[k]]+cost[k];for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
