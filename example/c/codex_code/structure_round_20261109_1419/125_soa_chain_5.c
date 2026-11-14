#include <stdio.h>
#include <stdlib.h>
int vals[5]={-6,1,8,-4,3},ls[5]={1,2,3,4,-1},rs[5]={-1,-1,-1,-1,-1};int walk(int k){if(k<0)return 0;return vals[k]+walk(ls[k])+walk(rs[k]);}int main(void){printf("%d\n",walk(0));return 0;}
