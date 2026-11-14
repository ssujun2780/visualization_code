#include <stdio.h>
int v[4]={0,0,1,2};
int lookup(int x){while(v[x]!=x)x=v[x];return x;}
int main(void){for(int i=0;i<4;i++)printf("%d ",lookup(i));return 0;}