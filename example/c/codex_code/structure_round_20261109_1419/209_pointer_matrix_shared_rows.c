#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int data[2][3]={{1,2,3},{4,5,6}};int*rows[3]={data[0],data[1],data[0]};int s=0;for(int i=0;i<3;i++)for(int j=0;j<3;j++)s+=rows[i][j];
rows[2][1]=9;printf("%d %d\n",s,rows[0][1]);return 0;}
