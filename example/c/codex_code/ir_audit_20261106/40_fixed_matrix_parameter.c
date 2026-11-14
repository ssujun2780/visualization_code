#include <stdio.h>
int sum(int rows,int a[][3]){int result=0;for(int i=0;i<rows;i++)for(int j=0;j<3;j++)result+=a[i][j];return result;}
int main(void){int a[2][3]={{1,2,3},{4,5,6}};printf("%d\n",sum(2,a));return 0;}
