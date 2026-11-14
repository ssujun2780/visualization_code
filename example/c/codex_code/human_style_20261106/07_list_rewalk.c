#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Cell{int value;struct Cell*next;}Cell;
int sum(Cell*p){int s=0;while(p){s+=p->value;p=p->next;}return s;}
int main(void){Cell head={0,NULL};int input[4]={3,1,4,1},hops=0,last=0;
 for(int i=0;i<4;i++){Cell*n=malloc(sizeof *n);if(!n)return 1;n->value=input[i];n->next=NULL;Cell*p=&head;while(p->next){p=p->next;hops++;}p->next=n;last=sum(head.next);}
 printf("%d %d\n",last,hops);Cell*p=head.next;while(p){Cell*next=p->next;free(p);p=next;}return 0;}
