#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int build(int*t,const int*a,int u,int l,int r){if(l==r)return t[u]=a[l];int m=(l+r)/2;return t[u]=build(t,a,2*u+1,l,m)+build(t,a,2*u+2,m+1,r);}
int query(const int*t,int u,int l,int r,int lo,int hi){if(hi<l||r<lo)return 0;if(lo<=l&&r<=hi)return t[u];int m=(l+r)/2;return query(t,2*u+1,l,m,lo,hi)+query(t,2*u+2,m+1,r,lo,hi);}
int main(void){int a[6]={1,2,3,4,5,6},t[24]={0};build(t,a,0,0,5);printf("%d\n",query(t,0,0,5,1,4));return 0;}
