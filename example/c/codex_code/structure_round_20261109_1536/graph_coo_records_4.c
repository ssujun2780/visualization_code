#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int u,v,w;}E;int main(void){E edges[6]={{0,1,0},{0,2,0},{1,2,1},{1,3,3},{2,3,2},{3,0,3}};int d[4];for(int i=0;i<4;i++)d[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int k=0;k<6;k++)if(d[edges[k].v]>d[edges[k].u]+edges[k].w)d[edges[k].v]=d[edges[k].u]+edges[k].w;for(int i=0;i<4;i++)printf("%d ",d[i]);printf("\n");return 0;}
