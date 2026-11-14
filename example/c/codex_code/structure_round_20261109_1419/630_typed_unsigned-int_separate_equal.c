#include <stdio.h>
unsigned int l[7]={1,3,5,99,99,99,99},r[7]={2,4,6,99,99,99,99};int v[7]={4,2,6,1,3,5,7};int walk(unsigned int k){if(k==99)return 0;return v[k]+walk(l[k])+walk(r[k]);}int main(void){printf("%d\n",walk(0));return 0;}
