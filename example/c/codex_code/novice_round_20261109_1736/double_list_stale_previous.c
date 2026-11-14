#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*next,*prev;}N;
int main(void){N a[5]={0};for(int i=0;i<5;i++){a[i].x=i+1;a[i].next=i<4?a+i+1:0;a[i].prev=i?a+i-1:0;}a[4].prev=a+2;N*head=a,*tail=a+4;int f=0,b=0;for(N*p=head;p;p=p->next)f+=p->x;for(N*p=tail;p;p=p->prev)b+=p->x;printf("%d %d\n",f,b);return 0;}
