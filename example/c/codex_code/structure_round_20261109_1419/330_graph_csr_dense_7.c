#include <stdio.h>
int main(void){int starts[8]={0,4,7,11,14,19,23,25},end[25]={1,3,4,6,2,5,6,1,3,4,5,2,4,6,1,2,3,5,6,0,2,4,6,0,5},weight[25]={5,3,8,7,3,2,2,4,8,1,7,2,2,8,2,8,6,0,7,3,8,4,3,8,3};int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int u=0;u<7;u++)for(int k=starts[u];k<starts[u+1];k++)if(d[u]<10000&&d[end[k]]>d[u]+weight[k])d[end[k]]=d[u]+weight[k];for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
