#include <stdio.h>
typedef struct{int value;struct{signed char l,r;}links;}Node;Node a[7]={{4,{1,2}},{2,{3,4}},{6,{5,6}},{1,{-1,-1}},{3,{-1,-1}},{5,{-1,-1}},{7,{-1,-1}}};int walk(signed char k){if(k==-1)return 0;return a[k].value+walk(a[k].links.l)+walk(a[k].links.r);}int main(void){printf("%d\n",walk(0));return 0;}
