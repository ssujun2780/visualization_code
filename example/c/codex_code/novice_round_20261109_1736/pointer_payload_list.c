#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int*value;struct N*next;}N;int main(void){N*head=0;for(int i=1;i<=4;i++){N*p=malloc(sizeof *p);int*v=malloc(sizeof *v);if(!p||!v){free(p);free(v);return 1;}*v=i;p->value=v;p->next=head;head=p;}int sum=0;for(N*p=head;p;p=p->next)sum+=*p->value;printf("%d\n",sum);while(head){N*n=head->next;free(head->value);free(head);head=n;}return 0;}
