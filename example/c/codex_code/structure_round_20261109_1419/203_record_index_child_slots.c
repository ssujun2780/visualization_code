#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value,c[2];}N;N a[5]={{4,{1,2}},{2,{3,4}},{6,{-1,-1}},{1,{-1,-1}},{3,{-1,-1}}};
int visit(int k){if(k<0)return 0;int s=a[k].value;for(int j=0;j<2;j++)s+=visit(a[k].c[j]);return s;}
int main(void){printf("%d\n",visit(0));return 0;}
