#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

int offsets[V+1]={0,2,3,4,5,5,5},targets[5]={1,2,3,3,3},weights[5]={0,4,-2,7,5};
int main(void){for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int u=0;u<V;u++)for(int k=offsets[u];k<offsets[u+1];k++){int v=targets[k],w=weights[k];if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("P0 %d %d\n",count,sum);return 0;}
