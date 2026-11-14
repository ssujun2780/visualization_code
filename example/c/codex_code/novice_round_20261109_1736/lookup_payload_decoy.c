#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int left,right,parent,count;}Thing;
int main(void){Thing x[4]={{1,2,0,9},{2,3,0,9},{3,0,1,9},{0,1,1,9}};int values[4]={7,2,8,3},total=0;for(int i=0;i<4;i++)total+=values[x[i].left]+x[i].right+x[i].parent;printf("%d\n",total);return 0;}
