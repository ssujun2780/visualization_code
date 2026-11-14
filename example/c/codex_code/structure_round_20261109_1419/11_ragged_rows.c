#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int lens[3]={1,3,2};int*rows[3];int s=0;for(int i=0;i<3;i++){rows[i]=calloc(lens[i],sizeof(int));if(!rows[i])return 1;
for(int j=0;j<lens[i];j++){rows[i][j]=i*10+j;s+=rows[i][j];}}
printf("%d %d\n",s,rows[1][2]);for(int i=0;i<3;i++)free(rows[i]);return 0;}
