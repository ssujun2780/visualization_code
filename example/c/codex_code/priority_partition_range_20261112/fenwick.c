#include <stdio.h>
int a[4]={1,2,3,4},v[5];
void add(int p,int d){for(int i=p;i<=4;i+=i&-i)v[i]+=d;}
int total(int i){int s=0;while(i){s+=v[i];i-=i&-i;}return s;}
int main(void){for(int i=0;i<4;i++)add(i+1,a[i]);printf("%d ",total(3));add(2,4);printf("%d ",total(4));return 0;}