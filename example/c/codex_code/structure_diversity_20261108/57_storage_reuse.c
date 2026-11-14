#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*next;}N;
int main(void){int results[2]={0};for(int round=0;round<2;round++){N*head=0;for(int i=0;i<2;i++){N*p=calloc(1,sizeof*p);if(!p){while(head){N*q=head;head=q->next;free(q);}return 1;}p->v=round*3+i+1;p->next=head;head=p;}
 for(N*p=head;p;p=p->next)results[round]+=p->v;while(head){N*p=head;head=p->next;free(p);}}
 printf("%d %d\n",results[0],results[1]);return 0;}
