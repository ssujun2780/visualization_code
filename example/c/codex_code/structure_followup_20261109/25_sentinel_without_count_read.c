#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int data;struct N*next;}N;
int main(void){N a[3]={{10,0},{20,0},{30,0}},header={3,a};a[0].next=&a[1];a[1].next=&a[2];a[2].next=&header;
int count=3,total=0;for(N*p=header.next;p!=&header;p=p->next)total+=p->data;
printf("%d %d\n",count,total);return 0;}
