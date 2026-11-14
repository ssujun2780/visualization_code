#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int**rows=malloc(2*sizeof *rows);if(!rows)return 1;for(int i=0;i<2;i++){rows[i]=calloc(3,sizeof **rows);if(!rows[i])return 1;for(int j=0;j<3;j++)rows[i][j]=i*10+j;}
 int total=0;for(int i=0;i<2;i++){int*t=malloc(3*sizeof *t);if(!t)return 1;memcpy(t,rows[i],3*sizeof *t);for(int j=0;j<3;j++)total+=t[j];free(t);}
 printf("%d\n",total);for(int i=0;i<2;i++)free(rows[i]);free(rows);return 0;}
