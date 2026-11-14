#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int total(int r,int c,int a[][4]){int sum=0;for(int i=0;i<r;i++)for(int j=0;j<c;j++)sum+=a[i][j];return sum;}
int main(void){int rows=3,cols=4;int (*a)[4]=malloc((size_t)rows*sizeof *a);if(!a)return 1;for(int i=0;i<rows;i++)for(int j=0;j<cols;j++)a[i][j]=10*i+j;int (*view)[4]=a+1;view[1][2]+=5;printf("%d %d\n",total(rows,cols,a),total(2,cols,view));free(a);return 0;}
