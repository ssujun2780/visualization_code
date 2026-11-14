#include <stdio.h>
typedef struct{int value;unsigned int l,r;}Node;Node a[7]={{4,1,2},{2,3,4},{6,5,6},{1,99,99},{3,99,99},{5,99,99},{7,99,99}};int walk(unsigned int k){if(k==99)return 0;return a[k].value+walk(a[k].l)+walk(a[k].r);}int main(void){printf("%d\n",walk(0));return 0;}
