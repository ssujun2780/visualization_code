#include <stdio.h>
typedef struct{int value;unsigned char l,r;}Node;Node a[7]={{4,1,2},{2,3,4},{6,5,6},{1,255,255},{3,255,255},{5,255,255},{7,255,255}};int walk(unsigned char k){if(k>=7)return 0;return a[k].value+walk(a[k].l)+walk(a[k].r);}int main(void){printf("%d\n",walk(0));return 0;}
