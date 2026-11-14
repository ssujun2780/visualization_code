#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

void add(int*b,int n,int i,int x){for(;i<=n;i+=i&-i)b[i]+=x;}
int total(const int*b,int i){int v=0;for(;i>0;i-=i&-i)v+=b[i];return v;}
int main(void){int b[7]={0};for(int i=1;i<=6;i++)add(b,6,i,i);printf("%d %d\n",total(b,6),total(b,3));return 0;}
