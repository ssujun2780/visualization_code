#include <stdio.h>
#include <stdlib.h>
int values[17]={-6,1,8,-4,3,-9,-2,5,-7,0,7,-5,2,9,-3,4,-8},up[17]={-1,0,0,2,1,2,1,6,3,8,8,4,5,4,5,3,12};int main(void){int s=0,steps=0;for(int i=0;i<17;i++){s+=values[i];int k=i;while(up[k]>=0){steps++;k=up[k];}}printf("%d %d\n",s,steps);return 0;}
