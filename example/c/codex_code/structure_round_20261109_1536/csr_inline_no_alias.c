#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int row[5]={0,2,4,5,6},col[6]={1,2,2,3,3,0},cost[6]={0,0,1,3,2,3};int d[4];for(int i=0;i<4;i++)d[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int u=0;u<4;u++)for(int k=row[u];k<row[u+1];k++){if(d[col[k]]>d[u]+cost[k])d[col[k]]=d[u]+cost[k];}for(int i=0;i<4;i++)printf("%d ",d[i]);printf("\n");return 0;}
