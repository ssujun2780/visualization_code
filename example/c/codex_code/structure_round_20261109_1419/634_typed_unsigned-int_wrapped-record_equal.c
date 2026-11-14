#include <stdio.h>
typedef struct{int value;struct{unsigned int l,r;}links;}Node;Node a[7]={{4,{1,2}},{2,{3,4}},{6,{5,6}},{1,{99,99}},{3,{99,99}},{5,{99,99}},{7,{99,99}}};int walk(unsigned int k){if(k==99)return 0;return a[k].value+walk(a[k].links.l)+walk(a[k].links.r);}int main(void){printf("%d\n",walk(0));return 0;}
