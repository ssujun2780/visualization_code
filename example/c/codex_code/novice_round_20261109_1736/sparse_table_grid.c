#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int table[3][5]={{8,3,7,1,5},{0},{0}};for(int level=1;level<3;level++)for(int k=0;k+(1<<level)<=5;k++){int a=table[level-1][k],b=table[level-1][k+(1<<(level-1))];table[level][k]=a<b?a:b;}printf("%d %d\n",table[1][0],table[2][1]);return 0;}
