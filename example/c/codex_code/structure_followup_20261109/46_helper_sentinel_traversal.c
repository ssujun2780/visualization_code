#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int data;struct N*next;}N;
int sum(N*head,N*stop){int total=0;for(N*p=head;p!=stop;p=p->next)total+=p->data;return total;}
int main(void){N a[3]={{10,0},{20,0},{30,0}},header={3,a};a[0].next=&a[1];a[1].next=&a[2];a[2].next=&header;
int count=header.data,total=sum(header.next,&header);
printf("%d %d\n",count,total);return 0;}
