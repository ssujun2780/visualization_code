#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

void put(int*t,int n,int i,int x){for(;i<=n;i+=i&-i)t[i]+=x;}
int get(const int*t,int i){int s=0;for(;i>0;i-=i&-i)s+=t[i];return s;}
int main(void){int tree[9]={0},payload[8]={1,2,3,4,5,6,7,8};for(int i=0;i<8;i++)put(tree,8,i+1,payload[i]);
printf("%d %d %d\n",get(tree,8),get(tree,5),get(tree,8)-get(tree,3));return 0;}
