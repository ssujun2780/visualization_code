#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[2][3]={{1,2,3},{4,5,6}},b[3][2]={{1,0},{0,1},{1,1}},out[2][2];
 for(int i=0;i<2;i++)for(int j=0;j<2;j++){int*t=malloc(3*sizeof *t);if(!t)return 1;for(int k=0;k<3;k++)t[k]=a[i][k]*b[k][j];int sum=0;for(int k=0;k<3;k++)sum+=t[k];out[i][j]=sum;free(t);}
 printf("%d %d %d %d\n",out[0][0],out[0][1],out[1][0],out[1][1]);return 0;}
