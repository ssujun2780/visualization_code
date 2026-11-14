#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[5],head,tail,count;}Queue;
void push(Queue*p,int x){p->data[p->tail]=x;p->tail=(p->tail+1)%5;p->count++;}
int pop(Queue*p){int x=p->data[p->head];p->head=(p->head+1)%5;p->count--;return x;}
int main(void){Queue q7919={{0},0,0,0};for(int i=0;i<5;i++)push(&q7919,i);printf("full %d\n",q7919.count);
int s=0;for(int i=0;i<3;i++)s+=pop(&q7919);push(&q7919,7);push(&q7919,7);printf("wrapped %d %d\n",q7919.count,q7919.data[q7919.head]);
while(q7919.count)s+=pop(&q7919);printf("empty %d %d\n",q7919.count,s);return 0;}
