#include <stdio.h>

int total(int*p){int n=0;for(int i=0;i<7;i++)for(int k=i;k!=-9;k=p[k])n++;return n;}
int main(void){int p[7]={2,2,-9,1,5,-9,5};printf("S0 %d\n",total(p));p[5]=2;
printf("S1 %d\n",total(p));p[3]=2;printf("S2 %d\n",total(p));return 0;}
