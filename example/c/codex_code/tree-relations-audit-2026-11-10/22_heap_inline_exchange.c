#include <stdio.h>

void exchange(int*a,int*b){int t=*a;*a=*b;*b=t;}
int main(void){int a[12]={0},used=0,data[5]={9,2,6,1,7};for(int k=0;k<5;k++){int i=used++;a[i]=data[k];
while(i>0){int p=(i-1)/2;if(a[p]<=a[i])break;{int saved=a[p];a[p]=a[i];a[i]=saved;}i=p;}}
printf("S0 %d %d\n",used,a[0]);a[0]=50;printf("S1 %d %d\n",used,a[0]);return 0;}
