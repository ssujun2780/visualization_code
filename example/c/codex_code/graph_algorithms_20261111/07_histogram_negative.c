#include <stdio.h>

int keys[6]={3,1,3,0,2,1},weights[6]={4,5,1,2,8,3},bins[4];
int main(void){for(int k=0;k<6;k++){int bucket=keys[k];bins[bucket]+=weights[k];}
printf("B %d %d %d %d\n",bins[0],bins[1],bins[2],bins[3]);return 0;}
