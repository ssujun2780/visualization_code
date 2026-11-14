#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int edge[5][5]={{0,1,1,0,0},{0,0,0,1,0},{0,0,0,1,0},{0,0,0,0,1},{0}},dist[5],queue[5],head=0,tail=0,checks=0;
for(int i=0;i<5;i++)dist[i]=-1;dist[0]=0;queue[tail++]=0;while(head<tail){int u=queue[head++];for(int v=0;v<5;v++){checks++;if(edge[u][v]&&dist[v]<0){dist[v]=dist[u]+1;queue[tail++]=v;}}}for(int i=0;i<5;i++)printf("%d ",dist[i]);printf("| %d\n",checks);return 0;}
