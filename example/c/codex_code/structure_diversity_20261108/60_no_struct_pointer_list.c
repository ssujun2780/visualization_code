#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int values[4]={1,2,3,4};void*nodes[4][2]={0};for(int i=0;i<4;i++){nodes[i][0]=&values[i];nodes[i][1]=i<3?nodes[i+1]:NULL;}
 int sum=0;void**p=nodes[0];while(p){sum+=*(int*)p[0];p=(void**)p[1];}printf("%d\n",sum);return 0;}
