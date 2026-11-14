#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int value,next;}N;
int main(void){N a[4]={{1,2},{4,-1},{2,3},{3,1}};int i=0,sum=0;while(i>=0){sum+=a[i].value;i=a[i].next;}printf("%d\n",sum);return 0;}
