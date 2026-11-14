#include <stdio.h>
typedef struct{int v,hop,unused;}N;
int scan(N*a,int h){int s=0;while(h!=-7){s+=a[h].v;h=a[h].hop;}return s;}
int main(void){N a[7];for(int j=0;j<7;j++)a[j]=(N){6,-7,123};a[5].hop=1;a[1].hop=4;int head=5;
printf("S0 %d\n",scan(a,head));a[1].hop=2;a[2].hop=4;printf("S1 %d\n",scan(a,head));return 0;}
