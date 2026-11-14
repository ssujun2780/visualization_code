#include <stdio.h>
int v[6];
int lookup(int x){if(v[x]==x)return x;return v[x]=lookup(v[x]);}
void join(int x,int y){x=lookup(x);y=lookup(y);if(x!=y)v[y]=x;}
int main(void){for(int i=0;i<6;i++)v[i]=i;join(0,1);join(2,3);join(0,2);join(4,5);for(int i=0;i<6;i++)printf("%d ",lookup(i));return 0;}