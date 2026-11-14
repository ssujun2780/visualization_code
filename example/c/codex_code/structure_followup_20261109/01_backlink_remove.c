#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N {int value; struct N*next; struct N**back;} N;
void add(N**head,N*x){x->next=*head;x->back=head;if(*head)(*head)->back=&x->next;*head=x;}
void erase(N*x){*x->back=x->next;if(x->next)x->next->back=x->back;x->next=0;x->back=0;}
int main(void){N nodes[5]={{1,0,0},{2,0,0},{3,0,0},{4,0,0},{5,0,0}};N*head=0;
for(int i=4;i>=0;i--)add(&head,&nodes[i]);erase(&nodes[2]);int sum=0;for(N*p=head;p;p=p->next)sum+=p->value;
printf("%d %d\n",sum,nodes[2].value);return 0;}
