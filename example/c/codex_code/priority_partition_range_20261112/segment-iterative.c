#include <stdio.h>
int a[4]={2,3,4,5},v[8];
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i>0;i--)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);
v[5]=7;for(int i=2;i;i/=2)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);return 0;}