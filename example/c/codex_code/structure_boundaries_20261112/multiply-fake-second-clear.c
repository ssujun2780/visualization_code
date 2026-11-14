#include <stdio.h>
#include <stdlib.h>

int a[4]={1,2,3,4},v[8],tag[8];
void apply(int k,int d){v[k]*=d;tag[k]*=d;}
void push(int k){if(tag[k]!=1){int d=tag[k];apply(k*2,d);apply(k*2+1,d);tag[k]=1;}}
int main(void){for(int i=0;i<8;i++)tag[i]=1;for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,2);apply(1,3);printf("%d %d ",v[1],tag[1]);push(1);apply(1,2);tag[1]=1;push(3);printf("%d ",v[7]);return 0;}