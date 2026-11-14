#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{struct N*c[2];int end;}N;N a[3];
int has(const char*s){N*p=a;while(*s){int k=*s-'0';if(!p->c[k])return 0;p=p->c[k];s++;}return p->end;}
int main(void){a[0].c[0]=a+1;a[1].c[1]=a+2;a[2].end=1;int x=has("01");a[2].end=0;int y=has("01");a[2].end=1;int z=has("01");printf("%d %d %d\n",x,y,z);return 0;}