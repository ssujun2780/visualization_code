#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

int entry[V],next[12],dest[12],cost[12],used;
void put(int u,int v,int w){int k=used++;dest[k]=v;cost[k]=w;next[k]=entry[u];entry[u]=k;}
void erase(int u,int v){int k=entry[u],last=-1;while(k!=-1){if(dest[k]==v){if(last<0)entry[u]=next[k];else next[last]=next[k];return;}last=k;k=next[k];}}
void scan(const char*tag){for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int u=0;u<V;u++)for(int k=entry[u];k!=-1;k=next[k]){int v=dest[k],w=cost[k];if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("%s %d %d\n",tag,count,sum);}
int main(void){for(int u=0;u<V;u++)entry[u]=-1;put(0,1,0);put(0,2,4);put(1,3,-2);put(2,3,7);put(3,3,5);scan("P0");erase(0,2);put(4,2,9);scan("P1");return 0;}
