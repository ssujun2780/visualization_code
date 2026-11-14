#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[4]={1,2,4,8},v[8],tag[8];void apply(int k,int d){v[k]|=d;tag[k]|=d;}void push(int k){if(tag[k]){int d=tag[k];apply(k*2,d);apply(k*2+1,d);tag[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]|v[2*i+1];apply(1,16);apply(1,32);int sum=v[1],t=tag[1];push(1);push(3);printf("%d %d %d\n",sum,t,v[7]);return 0;}