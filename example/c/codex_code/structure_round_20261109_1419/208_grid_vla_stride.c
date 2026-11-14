#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int n=3,stride=6,cols=4;int a[n][stride];int s=0;for(int i=0;i<n;i++)for(int j=0;j<stride;j++)a[i][j]=0;
for(int i=0;i<n;i++)for(int j=0;j<cols;j++){a[i][j]=i*10+j;s+=a[i][j];}printf("%d %d\n",s,a[2][3]);return 0;}
