#include <stdio.h>
#include <stdlib.h>
int values[5]={-6,1,8,-4,3},up[5]={-1,0,0,1,1};int main(void){int s=0,steps=0;for(int i=0;i<5;i++){s+=values[i];int k=i;while(up[k]>=0){steps++;k=up[k];}}printf("%d %d\n",s,steps);return 0;}
