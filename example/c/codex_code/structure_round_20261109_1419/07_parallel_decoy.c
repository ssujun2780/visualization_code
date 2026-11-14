#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int tree[5]={1,3,-1,-1,-1},left[5]={2,4,-1,-1,-1},parent[5]={4,2,6,1,3};
int main(void){int s=0;for(int i=0;i<5;i++)s+=tree[i]+left[i]+parent[i];printf("%d\n",s);return 0;}
