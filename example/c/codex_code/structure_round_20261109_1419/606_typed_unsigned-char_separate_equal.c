#include <stdio.h>
unsigned char l[7]={1,3,5,255,255,255,255},r[7]={2,4,6,255,255,255,255};int v[7]={4,2,6,1,3,5,7};int walk(unsigned char k){if(k==255)return 0;return v[k]+walk(l[k])+walk(r[k]);}int main(void){printf("%d\n",walk(0));return 0;}
