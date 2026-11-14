#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int*p=NULL,n=0,copies=0;for(int value=1;value<=6;value++){int*q=malloc((size_t)(n+1)*sizeof *q);if(!q){free(p);return 1;}for(int j=0;j<n;j++){q[j]=p[j];copies++;}q[n]=value;free(p);p=q;n++;}int sum=0;for(int i=0;i<n;i++)sum+=p[i];printf("%d %d\n",sum,copies);free(p);return 0;}
