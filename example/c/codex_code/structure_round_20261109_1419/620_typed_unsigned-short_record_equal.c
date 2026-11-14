#include <stdio.h>
typedef struct{int value;unsigned short l,r;}Node;Node a[7]={{4,1,2},{2,3,4},{6,5,6},{1,65535,65535},{3,65535,65535},{5,65535,65535},{7,65535,65535}};int walk(unsigned short k){if(k==65535)return 0;return a[k].value+walk(a[k].l)+walk(a[k].r);}int main(void){printf("%d\n",walk(0));return 0;}
