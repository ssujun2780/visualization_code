#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[3][4];int s=0;for(int j=0;j<4;j++)for(int i=0;i<3;i++){a[i][j]=i*10+j;s+=a[i][j];}
printf("%d %d\n",s,a[2][3]);return 0;}
