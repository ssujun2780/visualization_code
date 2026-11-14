#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int values[20]={-1,12,-6,7,20,2,15,-3,10,-8,5,18,0,13,-5,8,21},left[20]={1,3,5,7,9,11,13,15,-1,-1,-1,-1,-1,-1,-1,-1,-1},right[20]={2,4,6,8,10,12,14,16,-1,-1,-1,-1,-1,-1,-1,-1,-1},work[17],used=0,sum=0;work[used++]=0;while(used){int k=work[--used];sum+=values[k];if(left[k]!=-1)work[used++]=left[k];if(right[k]!=-1)work[used++]=right[k];}printf("%d\n",sum);return 0;}
