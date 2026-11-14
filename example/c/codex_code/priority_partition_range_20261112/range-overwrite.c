#include <stdio.h>
#include <string.h>
int a[4]={1,2,3,4},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);memset(v,0,sizeof(v));printf("%d ",v[1]);return 0;}