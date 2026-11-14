#include <stdio.h>

int main(void){int a[5]={2,4,6,8,10},b[5]={0};int x=0,y=0;
while(x<5){b[y]=a[x];x++;y++;}int sum=0;for(int i=0;i<5;i++)sum+=b[i];printf("S0 %d %d\n",sum,x==y);return 0;}
