#include <stdio.h>
#include <stdlib.h>

typedef struct N{int x;struct N*n;}N;N*head;
int walk(N*p){int s=0;for(;p;p=p->n)s+=p->x;return s;}
int main(void){N*p=calloc(2,sizeof *p);if(!p)return 0;p[0].x=1;p[1].x=2;p[0].n=p+1;head=p;printf("%d ",walk(head));head=0;free(p);p=calloc(2,sizeof *p);if(!p)return 0;p[0].x=4;p[1].x=5;p[0].n=p+1;head=p;printf("%d ",walk(head));head=0;free(p);return 0;}