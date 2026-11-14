#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct { int u,v,w; } E;
int add(int a,int b){return a+b;}
int min(int a,int b){return a<b?a:b;}
void relax(int*d,int u,int v,int w){if(d[v]>d[u]+w)d[v]=d[u]+w;}
int main(void){
 E edges[6]={{0,1,2},{0,2,0},{1,3,3},{2,3,1},{3,4,2},{4,1,1}};
 int d[5]={0,1000,1000,1000,1000};
 for(int pass=0;pass<5;pass++){
  for(int k=0;k<6;k++){
   if (d[edges[k].v] > d[edges[k].u] + edges[k].w) d[edges[k].v] = d[edges[k].u] + edges[k].w;
  }
 }
 printf("%d %d %d %d %d\n",d[0],d[1],d[2],d[3],d[4]);
 return 0;
}
