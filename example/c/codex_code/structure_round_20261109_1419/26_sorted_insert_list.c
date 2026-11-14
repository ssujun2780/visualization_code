#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*next;}N;
int main(void){int a[6]={4,1,4,2,9,0};N*head=0;for(int i=0;i<6;i++){N**p=&head;while(*p&&(*p)->v<=a[i])p=&(*p)->next;
N*n=malloc(sizeof(N));if(!n)return 1;n->v=a[i];n->next=*p;*p=n;}
int s=0;for(N*p=head;p;p=p->next)s=s*10+p->v;printf("%d\n",s);while(head){N*p=head;head=head->next;free(p);}return 0;}
