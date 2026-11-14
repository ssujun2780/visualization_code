#include <stdio.h>
#include <stdlib.h>
int values[2]={-6,1},up[2]={-1,0};int main(void){int s=0,steps=0;for(int i=0;i<2;i++){s+=values[i];int k=i;while(up[k]>=0){steps++;k=up[k];}}printf("%d %d\n",s,steps);return 0;}
