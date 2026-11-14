#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[18]={0};int(*rows)[6]=(int(*)[6])a;int s=0;for(int i=0;i<3;i++)for(int j=0;j<4;j++){rows[i][j]=i*10+j;s+=rows[i][j];}printf("%d %d\n",s,rows[2][3]);return 0;}
