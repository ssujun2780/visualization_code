#include <stdio.h>
unsigned short l[7]={1,3,5,65535,65535,65535,65535},r[7]={2,4,6,65535,65535,65535,65535};int v[7]={4,2,6,1,3,5,7};int walk(unsigned short k){if(k>=7)return 0;return v[k]+walk(l[k])+walk(r[k]);}int main(void){printf("%d\n",walk(0));return 0;}
