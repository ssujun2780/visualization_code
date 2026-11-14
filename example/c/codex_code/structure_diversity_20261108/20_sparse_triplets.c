#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a,b,w;}E;
int main(void){E entries[4]={{0,1,0},{1,2,2},{0,3,7},{2,3,1}};int x[4]={1,2,3,4},y[4]={0};
 for(int e=0;e<4;e++)y[entries[e].a]+=entries[e].w*x[entries[e].b];printf("%d\n",y[0]+y[1]+y[2]+y[3]);return 0;}
