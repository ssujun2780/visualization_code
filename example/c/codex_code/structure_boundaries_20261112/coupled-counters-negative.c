#include <stdio.h>
#include <stdlib.h>

int a[4]={1,2,3,4},v[8],stats[8];void update(int k,int d){v[k]+=d;stats[k]+=d;}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];update(1,5);update(2,6);stats[1]=0;printf("%d %d ",v[1],stats[2]);return 0;}