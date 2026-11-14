#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[5],head,tail,count;}Queue;
void push(Queue*p,int x){p->data[p->tail]=x;p->tail=(p->tail+1)%5;p->count++;}
int pop(Queue*p){int x=p->data[p->head];p->head=(p->head+1)%5;p->count--;return x;}
int main(void){Queue q={{0},0,0,0};for(int i=0;i<5;i++)push(&q,i);printf("full %d\n",q.count);
int s=0;for(int i=0;i<3;i++)s+=pop(&q);push(&q,7);push(&q,7);printf("wrapped %d %d\n",q.count,q.data[q.head]);
while(q.count)s+=pop(&q);printf("empty %d %d\n",q.count,s);return 0;}
