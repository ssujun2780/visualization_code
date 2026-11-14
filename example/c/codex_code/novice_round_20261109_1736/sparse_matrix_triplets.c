#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int row,col,value,used;}Entry;
int main(void){Entry e[8]={{2,0,5,1},{0,1,7,1},{2,2,3,1},{0,1,2,1}};int dense[3][3]={0};for(int i=0;i<8;i++)if(e[i].used)dense[e[i].row][e[i].col]+=e[i].value;int n=0,sum=0;for(int r=0;r<3;r++)for(int c=0;c<3;c++){sum+=dense[r][c];if(dense[r][c])n++;}printf("%d %d\n",n,sum);return 0;}
