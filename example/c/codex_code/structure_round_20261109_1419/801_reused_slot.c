#include <stdio.h>
#include <stdlib.h>

typedef struct{int v,next;}N;int total(N*a,int k){int s=0;while(k>=0){s+=a[k].v;k=a[k].next;}return s;}
int main(void){N a[4]={{2,1},{3,2},{5,-1},{0,-1}};int head=0;printf("before %d\n",total(a,head));a[0].next=2;printf("removed %d\n",total(a,head));a[1].v=11;a[1].next=-1;a[2].next=1;printf("reused %d\n",total(a,head));return 0;}
