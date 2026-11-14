#include <stdio.h>
#include <stdlib.h>

typedef struct{int v,l,r;}N;N a[12];int walk(int k){if(k<0)return 0;return a[k].v+walk(a[k].l)+walk(a[k].r);}
int main(void){for(int i=0;i<12;i++)a[i]=(N){0,-1,-1};a[0]=(N){4,1,2};a[1].v=2;a[2].v=6;int used=3;printf("%d %d\n",used,walk(0));return 0;}
