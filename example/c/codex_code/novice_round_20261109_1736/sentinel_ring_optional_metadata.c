#include <stdio.h>
#include <stdlib.h>

typedef struct N{int value,tag;struct N*next,*prev;}N;int main(void){N a[4]={0};N*head=a;for(int i=0;i<4;i++){a[i].value=0;a[i].tag=i==0;a[i].next=a+(i+1)%4;a[i].prev=a+(i+3)%4;}int n=0;for(N*p=head->next;p!=head;p=p->next)n++;printf("%d\n",n);a[1].next=a+3;a[3].prev=a+1;n=0;for(N*p=head->next;p!=head;p=p->next)n++;printf("%d\n",n);return 0;}
