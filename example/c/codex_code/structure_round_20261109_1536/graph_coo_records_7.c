#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int u,v,w;}E;int main(void){E edges[12]={{0,1,0},{0,2,0},{1,2,1},{1,3,3},{2,3,2},{2,4,6},{3,4,3},{3,5,2},{4,5,0},{4,6,5},{5,6,1},{6,0,2}};int d[7];for(int i=0;i<7;i++)d[i]=i?1000:0;for(int pass=0;pass<7;pass++)for(int k=0;k<12;k++)if(d[edges[k].v]>d[edges[k].u]+edges[k].w)d[edges[k].v]=d[edges[k].u]+edges[k].w;for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
