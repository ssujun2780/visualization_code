#include <stdio.h>
int p[5]={0,1,2,3,4};int main(void){int pairs[3][2]={{1,2},{3,4},{1,3}};
for(int i=0;i<3;i++){int a=pairs[i][0],b=pairs[i][1];while(p[a]!=a)a=p[a];while(p[b]!=b)b=p[b];if(a!=b)p[b]=a;}
int a=2,b=4;while(p[a]!=a)a=p[a];while(p[b]!=b)b=p[b];if(a!=b)p[b]=a;
printf("%d %d ",a,b);p[1]=2;printf("%d ",p[1]);return 0;}