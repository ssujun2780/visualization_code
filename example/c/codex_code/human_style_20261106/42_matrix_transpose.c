#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void transpose(int a[3][3],int b[3][3]){for(int i=0;i<3;i++)for(int j=0;j<3;j++){int temporary=a[i][j];b[j][i]=temporary;}}
int main(void){int a[3][3]={{1,2,3},{4,5,6},{7,8,9}},b[3][3],c[3][3];transpose(a,b);transpose(b,c);int total=0;for(int i=0;i<3;i++)for(int j=0;j<3;j++)total+=c[i][j];printf("%d %d %d\n",c[0][2],c[2][0],total);return 0;}
