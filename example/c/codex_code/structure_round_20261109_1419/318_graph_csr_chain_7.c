#include <stdio.h>
int main(void){int starts[8]={0,1,2,3,4,5,6,6},end[6]={1,2,3,4,5,6},weight[6]={2,5,6,1,3,7};int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int u=0;u<7;u++)for(int k=starts[u];k<starts[u+1];k++)if(d[u]<10000&&d[end[k]]>d[u]+weight[k])d[end[k]]=d[u]+weight[k];for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
