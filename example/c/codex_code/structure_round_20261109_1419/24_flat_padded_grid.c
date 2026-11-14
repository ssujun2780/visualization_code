#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[18]={0};int rows=3,cols=4,stride=6,s=0;for(int i=0;i<rows;i++)for(int j=0;j<cols;j++){a[i*stride+j]=i*10+j;s+=a[i*stride+j];}
printf("%d %d\n",s,a[2*stride+3]);return 0;}
