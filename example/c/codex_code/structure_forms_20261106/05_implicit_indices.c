#include <stdio.h>
#include <stdlib.h>
int sum(int*a,int n,int i){if(i>=n)return 0;int l=2*i+1;int r=l+1;int x=sum(a,n,l);int y=sum(a,n,r);return a[i]+x+y;}
int main(void){int a[7]={1,2,3,4,5,6,7};printf("%d\n",sum(a,7,0));return 0;}