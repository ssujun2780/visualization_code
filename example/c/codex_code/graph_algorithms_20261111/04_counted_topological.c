#include <stdio.h>

int rows[6][2]={{2,0},{2,3},{4,0},{4,0},{5,0},{0,0}},lengths[6]={1,2,1,1,1,0};
int degree[6]={0,0,2,1,2,1},queue[6],order[6];
int main(void){int h=0,t=0,n=0;for(int u=0;u<6;u++)if(degree[u]==0)queue[t++]=u;
while(h<t){int u=queue[h++];order[n++]=u;for(int k=0;k<lengths[u];k++){int v=rows[u][k];degree[v]--;if(degree[v]==0)queue[t++]=v;}}
printf("B %d %d %d %d %d %d\n",order[0],order[1],order[2],order[3],order[4],order[5]);return 0;}
