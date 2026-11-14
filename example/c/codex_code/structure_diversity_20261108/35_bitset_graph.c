#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){unsigned adj[4]={6,8,8,0},seen=1,front=1;while(front){unsigned next=0;for(unsigned u=0;u<4;u++)if(front&(1u<<u))next|=adj[u];front=next&~seen;seen|=front;}
 int count=0;for(unsigned i=0;i<4;i++)if(seen&(1u<<i))count++;printf("%d\n",count);return 0;}
