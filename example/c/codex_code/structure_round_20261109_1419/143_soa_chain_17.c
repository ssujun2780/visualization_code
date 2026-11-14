#include <stdio.h>
#include <stdlib.h>
int vals[17]={-6,1,8,-4,3,-9,-2,5,-7,0,7,-5,2,9,-3,4,-8},ls[17]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,-1},rs[17]={-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1};int walk(int k){if(k<0)return 0;return vals[k]+walk(ls[k])+walk(rs[k]);}int main(void){printf("%d\n",walk(0));return 0;}
