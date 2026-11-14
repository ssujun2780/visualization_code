#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int values[9]={-1,12,-6,7,20,2},left[9]={1,3,5,-1,-1,-1},right[9]={2,4,-1,-1,-1,-1},work[6],used=0,sum=0;work[used++]=0;while(used){int k=work[--used];sum+=values[k];if(left[k]!=-1)work[used++]=left[k];if(right[k]!=-1)work[used++]=right[k];}printf("%d\n",sum);return 0;}
