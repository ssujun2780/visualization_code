#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[25]={{0,1,5},{0,3,3},{0,4,8},{0,6,7},{1,2,3},{1,5,2},{1,6,2},{2,1,4},{2,3,8},{2,4,1},{2,5,7},{3,2,2},{3,4,2},{3,6,8},{4,1,2},{4,2,8},{4,3,6},{4,5,0},{4,6,7},{5,0,3},{5,2,8},{5,4,4},{5,6,3},{6,0,8},{6,5,3}};int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int k=0;k<25;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
