#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int total=0;for(int n=1;n<=8;n++){int*t=calloc((size_t)n+1,sizeof *t);if(!t)return 1;t[1]=1;for(int j=2;j<=n;j++)t[j]=t[j-1]+t[j-2];total+=t[n];free(t);}printf("%d\n",total);return 0;}
