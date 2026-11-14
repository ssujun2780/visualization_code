#include <stdio.h>
typedef struct{int value;int l,r;}Node;Node a[7]={{4,1,2},{2,3,4},{6,5,6},{1,-1,-1},{3,-1,-1},{5,-1,-1},{7,-1,-1}};int walk(int k){if(k==-1)return 0;return a[k].value+walk(a[k].l)+walk(a[k].r);}int main(void){printf("%d\n",walk(0));return 0;}
