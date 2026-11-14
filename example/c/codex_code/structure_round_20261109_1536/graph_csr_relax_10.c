#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int row[11]={0,2,4,6,8,10,12,14,16,17,18},col[18]={1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,0},cost[18]={0,0,1,3,2,6,3,2,0,5,1,1,2,4,3,0,0,1};int d[10];for(int i=0;i<10;i++)d[i]=i?1000:0;for(int pass=0;pass<10;pass++)for(int u=0;u<10;u++)for(int k=row[u];k<row[u+1];k++){int v=col[k],candidate=d[u]+cost[k];if(d[v]>candidate)d[v]=candidate;}for(int i=0;i<10;i++)printf("%d ",d[i]);printf("\n");return 0;}
