#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int a[3][3]={0};for(int r=0;r<3;r++)for(int c=0;c<3;c++){if(r==0||c==0)a[r][c]=1;else{int x=a[r-1][c];int y=a[r][c-1];int z=x+y;a[r][c]=z;}}
 printf("%d\n",a[2][2]);return 0;}
