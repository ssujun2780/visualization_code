#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int p[4]={0,1,0,2},q[4]={1,2,3,3},r[4]={0,2,7,1},d[4]={0,999,999,999};
 for(int repeat=0;repeat<3;repeat++)for(int i=0;i<4;i++){int from=p[i],to=q[i],weight=r[i];int maybe=d[from]+weight;if(maybe<d[to])d[to]=maybe;}
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);return 0;}
