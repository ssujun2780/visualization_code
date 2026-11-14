#include <stdio.h>
int a[4]={1,2,3,4},v[8],pending[8];
void apply(int k,int l,int r,int d){v[k]+=(r-l)*d;pending[k]+=d;}
void push(int k,int l,int r){int m=(l+r)/2;if(pending[k]){int x=pending[k];apply(k*2,l,m,x);apply(k*2+1,m,r,x);pending[k]=0;}}
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];apply(1,0,4,5);printf("%d %d ",v[1],pending[1]);push(1,0,4);push(3,2,4);printf("%d ",v[7]);return 0;}