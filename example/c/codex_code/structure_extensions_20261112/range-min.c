#include <stdio.h>
int a[4]={3,-2,5,0},v[8];int choose(int x,int y){return x<y?x:y;}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=choose(v[2*i],v[2*i+1]);printf("%d ",v[1]);v[6]=-7;for(int i=3;i;i/=2)v[i]=choose(v[2*i],v[2*i+1]);printf("%d ",v[1]);return 0;}