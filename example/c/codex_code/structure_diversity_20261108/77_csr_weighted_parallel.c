#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int start[5]={0,2,3,4,4},dst[4]={1,3,2,3},cost[4]={0,7,2,1},d[4]={0,999,999,999};
 for(int pass=0;pass<3;pass++)for(int u=0;u<4;u++)for(int e=start[u];e<start[u+1];e++)if(d[u]+cost[e]<d[dst[e]])d[dst[e]]=d[u]+cost[e];
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);return 0;}
