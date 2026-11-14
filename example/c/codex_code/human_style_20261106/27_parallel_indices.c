#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[3]={1,2,3},b[3]={4,5,6},out[3]={0},i=0,j=0,k=0;while(i<3){out[j++]=a[i++]+b[k++]*2;}printf("%d %d %d | %d %d %d\n",out[0],out[1],out[2],i,j,k);return 0;}
