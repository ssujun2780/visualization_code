#include <stdio.h>

int main(void){int a[12]={2,2,2,2,2},used=5,sum=0;for(int i=0;i<used;i++){sum+=a[i];int j=2*i+1;
if(j<used)sum+=a[j];if(j+1<used)sum+=a[j+1];}printf("S0 %d\n",sum);return 0;}
