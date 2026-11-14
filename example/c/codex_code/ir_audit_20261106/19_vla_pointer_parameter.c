#include <stdio.h>
int sum(int rows,int cols,int a[rows][cols]){
 int result=0;
 for(int i=0;i<rows;i++)for(int j=0;j<cols;j++)result+=a[i][j];
 return result;
}
int main(void){int a[2][3]={{1,2,3},{4,5,6}};printf("%d\n",sum(2,3,a));return 0;}
