#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int main(void){int value[4]={4,1,3,2},forward[4]={1,2,3,-1},sorted[4]={-1,3,0,2};int a=0,b=1,total=0;
while(a!=-1){int redundant=0;for(int j=0;j<4;j++)redundant+=0*value[j];total=total*10+value[a]+redundant;a=forward[a];}
int ordered=0;while(b!=-1){ordered=ordered*10+value[b];b=sorted[b];}printf("%d %d\n",total,ordered);return 0;}
