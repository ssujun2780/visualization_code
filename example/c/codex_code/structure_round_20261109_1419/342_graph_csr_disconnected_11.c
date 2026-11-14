#include <stdio.h>
int main(void){int starts[12]={0,4,8,12,16,20,20,20,20,20,20,20},end[20]={1,2,3,4,0,2,3,4,0,1,3,4,0,1,2,4,0,1,2,3},weight[20]={1,1,6,1,0,7,2,4,8,2,0,8,8,3,4,5,0,4,7,5};int d[11];for(int i=0;i<11;i++)d[i]=i?10000:0;
for(int pass=0;pass<11;pass++)for(int u=0;u<11;u++)for(int k=starts[u];k<starts[u+1];k++)if(d[u]<10000&&d[end[k]]>d[u]+weight[k])d[end[k]]=d[u]+weight[k];for(int i=0;i<11;i++)printf("%d ",d[i]);printf("\n");return 0;}
