#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int par[7]={0,0,1,3,3,5,5},rank[7]={99,99,99,99,99,99,99};int find(int x){if(par[x]==x)return x;return find(par[x]);}
int main(void){int counts[7]={0};for(int i=0;i<7;i++)counts[find(i)]++;printf("%d %d %d\n",counts[0],counts[3],counts[5]);par[3]=2;for(int i=0;i<7;i++)find(i);printf("%d\n",find(4));return 0;}
