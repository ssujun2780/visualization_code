#include <stdio.h>
int a[4]={8,2,8,1},v[8];int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--){int x=v[2*i],y=v[2*i+1];v[i]=x>y?x:y;}printf("%d ",v[1]);return 0;}