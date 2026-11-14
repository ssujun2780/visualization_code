#include <stdio.h>
int main(void){int starts[4]={0,1,2,2},end[2]={1,2},weight[2]={6,4};int d[3];for(int i=0;i<3;i++)d[i]=i?10000:0;
for(int pass=0;pass<3;pass++)for(int u=0;u<3;u++)for(int k=starts[u];k<starts[u+1];k++)if(d[u]<10000&&d[end[k]]>d[u]+weight[k])d[end[k]]=d[u]+weight[k];for(int i=0;i<3;i++)printf("%d ",d[i]);printf("\n");return 0;}
