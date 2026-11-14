#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct { int u,v,X164249d293; } X8ed949db41;
int add(int a,int b){return a+b;}
int min(int a,int b){return a<b?a:b;}
void relax(int*X6dd5b969ae,int u,int v,int X164249d293){if(X6dd5b969ae[v]>X6dd5b969ae[u]+X164249d293)X6dd5b969ae[v]=X6dd5b969ae[u]+X164249d293;}
int main(void){
 X8ed949db41 Xdbf8dbd7c1[6]={{0,1,2},{0,2,0},{1,3,3},{2,3,1},{3,4,2},{4,1,1}};
 int X6dd5b969ae[5]={0,1000,1000,1000,1000};
 for(int pass=0;pass<5;pass++){
  for(int k=0;k<6;k++){
   int X7f5db49c16 = X6dd5b969ae[Xdbf8dbd7c1[k].u] + Xdbf8dbd7c1[k].X164249d293;
if (X6dd5b969ae[Xdbf8dbd7c1[k].v] > X7f5db49c16) X6dd5b969ae[Xdbf8dbd7c1[k].v] = X7f5db49c16;
  }
 }
 printf("%d %d %d %d %d\n",X6dd5b969ae[0],X6dd5b969ae[1],X6dd5b969ae[2],X6dd5b969ae[3],X6dd5b969ae[4]);
 return 0;
}
