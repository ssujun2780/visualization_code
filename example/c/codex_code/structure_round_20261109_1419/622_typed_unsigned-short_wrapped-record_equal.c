#include <stdio.h>
typedef struct{int value;struct{unsigned short l,r;}links;}Node;Node a[7]={{4,{1,2}},{2,{3,4}},{6,{5,6}},{1,{65535,65535}},{3,{65535,65535}},{5,{65535,65535}},{7,{65535,65535}}};int walk(unsigned short k){if(k==65535)return 0;return a[k].value+walk(a[k].links.l)+walk(a[k].links.r);}int main(void){printf("%d\n",walk(0));return 0;}
