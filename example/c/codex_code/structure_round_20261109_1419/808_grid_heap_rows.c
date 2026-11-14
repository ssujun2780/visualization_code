#include <stdio.h>
#include <stdlib.h>

int main(void){int(*rows)[6]=calloc(3,sizeof(*rows));if(!rows)return 1;int s=0;for(int i=0;i<3;i++)for(int j=0;j<4;j++){rows[i][j]=10*i+j;s+=rows[i][j];}printf("%d %d\n",s,rows[2][3]);free(rows);return 0;}
