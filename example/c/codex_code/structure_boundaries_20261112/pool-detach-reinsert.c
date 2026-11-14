#include <stdio.h>
#include <stdlib.h>

typedef struct N{int x;struct N*n;}N;N a[3]={{1,0},{2,0},{3,0}};N*head=a;
int walk(void){int s=0;for(N*p=head;p;p=p->n)s+=p->x;return s;}
int main(void){a[0].n=a+1;a[1].n=a+2;printf("%d ",walk());a[0].n=a[1].n;a[1].n=0;printf("%d ",walk());a[1].x=8;a[1].n=head;head=a+1;printf("%d ",walk());return 0;}