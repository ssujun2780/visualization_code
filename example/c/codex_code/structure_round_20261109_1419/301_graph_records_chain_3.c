#include <stdio.h>
typedef struct{int src,dst,w;}Edge;int main(void){Edge edges[2]={{0,1,6},{1,2,4}};int d[3];for(int i=0;i<3;i++)d[i]=i?10000:0;
for(int pass=0;pass<3;pass++)for(int k=0;k<2;k++)if(d[edges[k].src]<10000&&d[edges[k].dst]>d[edges[k].src]+edges[k].w)d[edges[k].dst]=d[edges[k].src]+edges[k].w;for(int i=0;i<3;i++)printf("%d ",d[i]);printf("\n");return 0;}
