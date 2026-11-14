#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct Hook{struct Hook*next,*prev;}Hook;
typedef struct Item{long long metadata;Hook link;int value;}Item;
Item*owner(Hook*h){return(Item*)((char*)h - offsetof(Item,link));}
void append(Hook*head,Hook*n){n->prev=head->prev;n->next=head;head->prev->next=n;head->prev=n;}
int main(void){Hook head={&head,&head};Item a[3]={{.value=2},{.value=4},{.value=8}};for(int i=0;i<3;i++)append(&head,&a[i].link);int sum=0;for(Hook*h=head.next;h!=&head;h=h->next)sum+=owner(h)->value;printf("%d\n",sum);return 0;}
