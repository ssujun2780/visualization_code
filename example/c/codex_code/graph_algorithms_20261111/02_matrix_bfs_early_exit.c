#include <stdio.h>

int matrix[6][6]={{0,1,1,0,0,0},{0,0,0,1,0,0},{0,0,0,1,0,0},{1,0,0,0,0,0},{0},{0}};
int flags[6],queue[6],popped[6];
int main(void){int h=0,t=0,count=0;queue[t++]=0;flags[0]=1;
while(h<t){int u=queue[h++];popped[count++]=u;if(u==1)break;
for(int v=0;v<6;v++)if(matrix[u][v]&&!flags[v]){flags[v]=1;queue[t++]=v;}}
printf("B %d %d %d %d %d\n",count,popped[0],popped[1],flags[2],t-h);return 0;}
