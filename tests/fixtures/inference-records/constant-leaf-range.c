#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int v[8];int main(void){v[4]=1;v[5]=2;v[6]=4;v[7]=8;for(int i=3;i;i--)v[i]=v[2*i]+v[2*i+1];printf("%d\n",v[1]);return 0;}