#include <stdio.h>
#include <stdlib.h>

int a[4]={1,2,3,4},v[8],tag[8],valid[8];
void apply(int k,int l,int r,int d){v[k]=(r-l)*d;tag[k]=d;valid[k]=1;}
void push(int k,int l,int r){if(valid[k]){int d=tag[k],m=(l+r)/2;apply(k*2,l,m,d);apply(k*2+1,m,r,d);valid[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,0,4,0);printf("%d %d ",v[1],tag[1]);push(1,0,4);apply(3,2,4,7);push(3,2,4);printf("%d %d ",v[6],v[7]);return 0;}