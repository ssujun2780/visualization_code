#include <stdio.h>
signed char l[7]={1,3,5,-1,-1,-1,-1},r[7]={2,4,6,-1,-1,-1,-1};int v[7]={4,2,6,1,3,5,7};int walk(signed char k){if(k==-1)return 0;return v[k]+walk(l[k])+walk(r[k]);}int main(void){printf("%d\n",walk(0));return 0;}
