#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

typedef struct{int to,weight,from;}E;E links[6]={{1,0,0},{2,4,0},{3,-2,1},{3,7,2},{3,5,3},{3,6,1}};
int main(void){for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int k=0;k<6;k++){int u=links[k].from,v=links[k].to,w=links[k].weight;if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("P0 %d %d\n",count,sum);return 0;}
