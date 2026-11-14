#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int from,to,cost;}E;
int main(void){E edges[5]={{0,1,0},{0,2,5},{1,2,2},{1,3,9},{2,3,1}};int d[4]={0,100,100,100};
for(int p=0;p<4;p++)for(int k=0;k<5;k++){E e=edges[k];if(d[e.to]>d[e.from]+e.cost)d[e.to]=d[e.from]+e.cost;}
printf("%d %d %d %d\n",d[0],d[1],d[2],d[3]);return 0;}
