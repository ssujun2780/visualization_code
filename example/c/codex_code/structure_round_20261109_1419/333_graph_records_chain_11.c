#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[10]={{0,1,3},{1,2,6},{2,3,6},{3,4,6},{4,5,0},{5,6,1},{6,7,4},{7,8,6},{8,9,7},{9,10,7}};int d[11];for(int i=0;i<11;i++)d[i]=i?10000:0;
for(int pass=0;pass<11;pass++)for(int k=0;k<10;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<11;i++)printf("%d ",d[i]);printf("\n");return 0;}
