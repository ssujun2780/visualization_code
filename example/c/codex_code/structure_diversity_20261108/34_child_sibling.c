#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*child,*next;}N;
int sum(N*p){int out=0;while(p){out+=p->v+sum(p->child);p=p->next;}return out;}
int main(void){N n[5]={{1,0,0},{2,0,0},{3,0,0},{4,0,0},{5,0,0}};n[0].child=&n[1];n[1].next=&n[2];n[2].next=&n[3];n[1].child=&n[4];printf("%d\n",sum(n));return 0;}
