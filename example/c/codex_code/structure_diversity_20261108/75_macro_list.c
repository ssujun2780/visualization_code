#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*n;}N;
#define PUSH(h,o) do{(o)->n=(h);(h)=(o);}while(0)
#define NEXT(p) ((p)->n)
int main(void){N a[3]={{1,0},{2,0},{3,0}},*head=0;for(int i=0;i<3;i++)PUSH(head,&a[i]);int out=0;for(N*p=head;p;p=NEXT(p))out=out*10+p->v;printf("%d\n",out);return 0;}
