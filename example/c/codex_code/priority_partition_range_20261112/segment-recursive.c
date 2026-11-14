#include <stdio.h>
int a[4]={1,2,3,4},v[16];
void build(int k,int l,int r){if(r-l==1){v[k]=a[l];return;}int m=(l+r)/2;build(2*k,l,m);build(2*k+1,m,r);v[k]=v[2*k]+v[2*k+1];}
void change(int k,int l,int r,int p,int x){if(r-l==1){v[k]=x;return;}int m=(l+r)/2;if(p<m)change(2*k,l,m,p,x);else change(2*k+1,m,r,p,x);v[k]=v[2*k]+v[2*k+1];}
int main(void){build(1,0,4);printf("%d ",v[1]);change(1,0,4,1,6);printf("%d ",v[1]);return 0;}