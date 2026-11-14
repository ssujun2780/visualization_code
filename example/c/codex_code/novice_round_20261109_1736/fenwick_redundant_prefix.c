#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int bit[9]={0},plain[8],cache[9]={0};for(int i=0;i<8;i++){plain[i]=i+1;for(int k=i+1;k<=8;k+=k&-k)bit[k]+=plain[i];for(int j=i+1;j<=8;j++)cache[j]+=plain[i];}int s=0;for(int k=7;k>0;k-=k&-k)s+=bit[k];printf("%d %d\n",s,cache[7]);return 0;}
