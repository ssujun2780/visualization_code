#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int main(void){int lengths[3]={2,4,1};int**rows=calloc(3,sizeof *rows);if(!rows)return 1;
for(int i=0;i<3;i++){rows[i]=malloc(lengths[i]*sizeof **rows);if(!rows[i])return 1;for(int j=0;j<lengths[i];j++)rows[i][j]=10*i+j;}
int*alias=rows[1];int sum=0;for(int i=0;i<3;i++)for(int j=0;j<lengths[i];j++)sum+=rows[i][j];alias[2]+=5;
printf("%d %d\n",sum,rows[1][2]);for(int i=0;i<3;i++)free(rows[i]);free(rows);return 0;}
