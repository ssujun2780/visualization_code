#include <stdio.h>
#include <stdlib.h>
int vals[2]={-6,1},ls[2]={1,-1},rs[2]={-1,-1};int walk(int k){if(k<0)return 0;return vals[k]+walk(ls[k])+walk(rs[k]);}int main(void){printf("%d\n",walk(0));return 0;}
