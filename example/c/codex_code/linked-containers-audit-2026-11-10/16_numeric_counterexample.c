#include <stdio.h>
int main(void){int values[3]={5,5,5},links[3]={2,0,1};int s=0;for(int i=0;i<3;i++)s+=values[i]+links[i];
printf("S0 %d\n",s);return 0;}
