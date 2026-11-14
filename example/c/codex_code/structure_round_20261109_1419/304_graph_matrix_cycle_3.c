#include <stdio.h>
int main(void){int w[3][3]={{0,6,0},{0,0,4},{2,0,0}},has[3][3]={{0,1,0},{0,0,1},{1,0,0}};int d[3];for(int i=0;i<3;i++)d[i]=i?10000:0;
for(int pass=0;pass<3;pass++)for(int u=0;u<3;u++)for(int v=0;v<3;v++)if(has[u][v]&&d[u]<10000&&d[v]>d[u]+w[u][v])d[v]=d[u]+w[u][v];for(int i=0;i<3;i++)printf("%d ",d[i]);printf("\n");return 0;}
