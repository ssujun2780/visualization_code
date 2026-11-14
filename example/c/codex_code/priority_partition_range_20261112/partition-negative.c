#include <stdio.h>
int v[6]={-1,-1,-1,-1,-1,-1};
int lookup(int x){int y=x;while(v[y]>=0)y=v[y];while(x!=y){int t=v[x];v[x]=y;x=t;}return y;}
void join(int a,int b){a=lookup(a);b=lookup(b);if(a==b)return;if(v[a]>v[b]){int t=a;a=b;b=t;}v[a]+=v[b];v[b]=a;}
int main(void){join(0,1);join(0,2);join(3,4);for(int i=0;i<6;i++)printf("%d ",lookup(i));return 0;}