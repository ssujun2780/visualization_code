#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int**a=calloc(2,sizeof*a);if(!a)return 1;for(int r=0;r<2;r++){a[r]=calloc(3,sizeof**a);if(!a[r]){for(int j=0;j<r;j++)free(a[j]);free(a);return 1;}}
 int sum=0;for(int r=0;r<2;r++)for(int c=0;c<3;c++){a[r][c]=r*3+c+1;sum+=a[r][c];}
 printf("%d\n",sum);for(int r=0;r<2;r++)free(a[r]);free(a);return 0;}
