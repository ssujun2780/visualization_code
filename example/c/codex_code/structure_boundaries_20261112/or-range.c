#include <stdio.h>
#include <stdlib.h>

int a[4]={1,2,4,8},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[i*2]|v[i*2+1];printf("%d ",v[1]);v[6]=0;for(int i=3;i;i/=2)v[i]=v[2*i]|v[2*i+1];printf("%d ",v[1]);return 0;}