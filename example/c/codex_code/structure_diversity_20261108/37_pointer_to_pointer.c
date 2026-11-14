#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int x;struct N*next;}N;
int main(void){N*head=0;for(int i=3;i>=1;i--){N*p=malloc(sizeof*p);if(!p){while(head){N*q=head;head=q->next;free(q);}return 1;}p->x=i;p->next=head;head=p;}
 N**slot=&head;while(*slot){if((*slot)->x==2){N*old=*slot;*slot=old->next;free(old);}else slot=&(*slot)->next;}
 int sum=0;while(head){N*p=head;sum=sum*10+p->x;head=p->next;free(p);}printf("%d\n",sum);return 0;}
