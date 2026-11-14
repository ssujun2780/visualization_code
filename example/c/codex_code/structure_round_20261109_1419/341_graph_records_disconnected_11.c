#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[20]={{0,1,1},{0,2,1},{0,3,6},{0,4,1},{1,0,0},{1,2,7},{1,3,2},{1,4,4},{2,0,8},{2,1,2},{2,3,0},{2,4,8},{3,0,8},{3,1,3},{3,2,4},{3,4,5},{4,0,0},{4,1,4},{4,2,7},{4,3,5}};int d[11];for(int i=0;i<11;i++)d[i]=i?10000:0;
for(int pass=0;pass<11;pass++)for(int k=0;k<20;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<11;i++)printf("%d ",d[i]);printf("\n");return 0;}
