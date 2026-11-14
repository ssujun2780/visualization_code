#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x,deleted;struct N*next,*prev,*jump,*owner;}N;
int main(void){N box[5]={0};for(int i=0;i<5;i++){box[i].x=10+i;box[i].next=i<4?box+i+1:0;box[i].prev=i?box+i-1:0;box[i].jump=box+((i+2)%5);box[i].owner=box;}
N*head=box;box[2].deleted=1;int sum=0,count=0;for(N*p=head;p;p=p->next){if(!p->deleted)sum+=p->x;count++;}
int back=0;for(N*p=box+4;p;p=p->prev)back+=p->x;
printf("%d %d %d\n",count,sum,back);return 0;}
