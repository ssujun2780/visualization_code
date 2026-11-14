#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct {int a,b,w;}E;
int main(void){int storage[10]={0};int*d=storage+3;E edges[3]={{0,1,3},{1,2,2},{2,3,1}};
 for(int i=0;i<4;i++)d[i]=i?100:0;
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[edges[k].b]>d[edges[k].a]+edges[k].w)d[edges[k].b]=d[edges[k].a]+edges[k].w;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);return 0;}

