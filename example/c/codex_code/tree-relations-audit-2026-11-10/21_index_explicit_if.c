#include <stdio.h>

typedef struct{int noise,hi,v,lo;}N;
int walk(N*a,int p){if(p<0)return 0;return 1+walk(a,a[p].lo)+walk(a,a[p].hi);}
int main(void){N a[8];for(int i=0;i<8;i++)a[i]=(N){91,-7,2,-7};int root=6;
a[6].lo=1;a[6].hi=5;a[1].lo=0;a[1].hi=3;printf("S0 %d\n",walk(a,root));
a[1].hi=-7;a[5].lo=3;printf("S1 %d\n",walk(a,root));return 0;}
