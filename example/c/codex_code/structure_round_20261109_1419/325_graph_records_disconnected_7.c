#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[6]={{0,1,5},{0,2,5},{1,0,3},{1,2,6},{2,0,4},{2,1,8}};int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int k=0;k<6;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
