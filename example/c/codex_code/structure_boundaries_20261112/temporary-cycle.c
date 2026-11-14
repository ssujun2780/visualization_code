#include <stdio.h>
#include <stdlib.h>

typedef struct N{int x;struct N*n;}N;N a[2]={{1,0},{2,0}};N*head=a;
void mark(void){N*p=head;for(int i=0;i<2&&p;i++)p=p->n;printf("%d ",head->x);}
int main(void){a[0].n=a+1;mark();a[1].n=a;mark();a[1].n=0;mark();return 0;}