#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[9],n=0;void put(int x){a[n]=x;n=n+1;}int take(void){int x=a[0];for(int i=1;i<n;i++)a[i-1]=a[i];n=n-1;return x;}
int main(void){put(3);put(1);put(3);int x=take();put(7);int y=take();printf("%d %d %d %d\n",x,y,n,a[0]);return 0;}
