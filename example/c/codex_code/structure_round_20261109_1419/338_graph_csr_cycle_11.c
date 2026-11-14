#include <stdio.h>
int main(void){int starts[12]={0,1,2,3,4,5,6,7,8,9,10,11},end[11]={1,2,3,4,5,6,7,8,9,10,0},weight[11]={3,6,6,6,0,1,4,6,7,7,0};int d[11];for(int i=0;i<11;i++)d[i]=i?10000:0;
for(int pass=0;pass<11;pass++)for(int u=0;u<11;u++)for(int k=starts[u];k<starts[u+1];k++)if(d[u]<10000&&d[end[k]]>d[u]+weight[k])d[end[k]]=d[u]+weight[k];for(int i=0;i<11;i++)printf("%d ",d[i]);printf("\n");return 0;}
