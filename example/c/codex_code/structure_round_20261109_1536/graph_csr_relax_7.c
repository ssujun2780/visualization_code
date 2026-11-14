#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int row[8]={0,2,4,6,8,10,11,12},col[12]={1,2,2,3,3,4,4,5,5,6,6,0},cost[12]={0,0,1,3,2,6,3,2,0,5,1,2};int d[7];for(int i=0;i<7;i++)d[i]=i?1000:0;for(int pass=0;pass<7;pass++)for(int u=0;u<7;u++)for(int k=row[u];k<row[u+1];k++){int v=col[k],candidate=d[u]+cost[k];if(d[v]>candidate)d[v]=candidate;}for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
