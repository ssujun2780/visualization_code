#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int edge[8][3];for(int i=0;i<8;i++)for(int j=0;j<3;j++)edge[i][j]=-1;int used=1;int terminal[8]={0};int words[3][3]={{0,1,-1},{0,2,-1},{2,-1,-1}};for(int w=0;w<3;w++){int p=0;for(int k=0;k<3&&words[w][k]!=-1;k++){int ch=words[w][k];if(edge[p][ch]==-1)edge[p][ch]=used++;p=edge[p][ch];}terminal[p]=1;}int p=0;p=edge[p][0];p=edge[p][2];printf("%d %d %d\n",used,p,terminal[p]);return 0;}
