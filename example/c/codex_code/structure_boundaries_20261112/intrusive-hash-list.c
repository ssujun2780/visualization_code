#include <stdio.h>
#include <stdlib.h>

typedef struct N{int key;struct N *bucket,*next,*prev;}N;
N v[3]={{1,0,0,0},{3,0,0,0},{2,0,0,0}};N*tab[2],*head,*tail;
void insert(N*p){int h=p->key%2;p->bucket=tab[h];tab[h]=p;p->prev=tail;if(tail)tail->next=p;else head=p;tail=p;}
N*lookup(int k){for(N*p=tab[k%2];p;p=p->bucket)if(p->key==k)return p;return 0;}
int walk(void){int n=0;for(N*p=head;p;p=p->next)n+=p->key;return n;}
int main(void){for(int i=0;i<3;i++)insert(v+i);printf("%d %d ",lookup(3)->key+lookup(1)->key,walk());N*p=lookup(2);p->prev->next=0;tail=p->prev;p->next=head;head->prev=p;p->prev=0;head=p;printf("%d %d ",walk(),lookup(3)->key+lookup(1)->key);return 0;}