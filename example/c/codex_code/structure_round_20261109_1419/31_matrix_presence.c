#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int w[4][4]={{0,0,5,0},{0,0,2,9},{0,0,0,1},{0}},has[4][4]={{0,1,1,0},{0,0,1,1},{0,0,0,1},{0}},d[4]={0,100,100,100};
for(int pass=0;pass<4;pass++)for(int i=0;i<4;i++)for(int j=0;j<4;j++)if(has[i][j]&&d[j]>d[i]+w[i][j])d[j]=d[i]+w[i][j];
printf("%d %d %d %d\n",d[0],d[1],d[2],d[3]);return 0;}
