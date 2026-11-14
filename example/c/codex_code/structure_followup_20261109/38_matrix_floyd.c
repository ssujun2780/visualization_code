#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[4][4];for(int i=0;i<4;i++)for(int j=0;j<4;j++)a[i][j]=i==j?0:999;a[0][1]=2;a[1][2]=3;a[0][2]=9;a[2][3]=1;
for(int k=0;k<4;k++)for(int i=0;i<4;i++)for(int j=0;j<4;j++){int candidate=a[i][k]+a[k][j];if(candidate<a[i][j])a[i][j]=candidate;else a[i][j]=a[i][j];}
printf("%d %d %d\n",a[0][3],a[3][0],a[1][3]);return 0;}
