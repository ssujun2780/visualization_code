#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*next;}N;
int main(void){N a[4]={{1,0},{2,0},{3,0},{4,0}},anchor={999,0};anchor.next=a;for(int i=0;i<3;i++)a[i].next=&a[i+1];a[3].next=&anchor;
 N*head=&anchor;int sum=0;for(N*p=head->next;p!=head;p=p->next)sum+=p->v;printf("%d\n",sum);return 0;}
