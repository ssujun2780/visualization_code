#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int v,prev,next;}N;
int main(void){N a[4]={{1,-1,1},{2,0,2},{3,1,3},{4,2,-1}};int total=0;
 for(int i=0;i!=-1;i=a[i].next)total+=a[i].v;for(int i=3;i!=-1;i=a[i].prev)total+=a[i].v;
 printf("%d\n",total);return 0;}
