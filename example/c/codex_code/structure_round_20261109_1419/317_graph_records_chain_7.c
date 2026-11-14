#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[6]={{0,1,2},{1,2,5},{2,3,6},{3,4,1},{4,5,3},{5,6,7}};int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int k=0;k<6;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
