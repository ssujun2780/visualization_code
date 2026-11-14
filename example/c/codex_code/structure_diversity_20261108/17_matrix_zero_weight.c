#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int g[4][4]={{-1,0,-1,7},{-1,-1,2,-1},{-1,-1,-1,1},{-1,-1,-1,-1}};
 int q[4]={0},seen[4]={1,0,0,0},h=0,t=1;
 while(h<t){int u=q[h++];for(int v=0;v<4;v++){if(g[u][v]>=0&&!seen[v]){seen[v]=1;q[t++]=v;}}}
 printf("%d\n",t);return 0;}
