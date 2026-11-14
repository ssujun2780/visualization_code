#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a,b,w;}E;
int main(void){E edges[4]={{0,1,0},{1,2,2},{0,3,7},{2,3,1}};int d[4]={0,999,999,999};
 for(int pass=0;pass<3;pass++)for(int e=0;e<4;e++)if(d[edges[e].a]+edges[e].w<d[edges[e].b])d[edges[e].b]=d[edges[e].a]+edges[e].w;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);return 0;}
