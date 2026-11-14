#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

int table[V][V],totals[V];
int main(void){int sum=0;for(int i=0;i<V;i++)for(int j=0;j<V;j++){table[i][j]=i-j;totals[i]+=table[i][j];}
for(int i=0;i<V;i++)sum+=totals[i];printf("P0 %d %d\n",0,sum);return 0;}
