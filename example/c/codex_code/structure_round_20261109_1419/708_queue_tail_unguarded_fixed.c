#include <stdio.h>
#include <stdlib.h>
typedef struct{int data[5];int count,head,tail,cap;}Q;
void push(Q*q,int x){q->data[q->tail]=x;q->tail=(q->tail+1)%5;q->count++;}
int pop(Q*q){int x=q->data[q->head];q->head=(q->head+1)%5;q->count--;return x;}
int main(void){Q box={{0},0,0,0,5};
push(&box,11);push(&box,22);push(&box,33);int s=pop(&box);push(&box,44);push(&box,55);int sum=0;for(int i=0;i<box.count;i++)sum+=box.data[(box.head+i)%5];
printf("active %d %d\n",box.count,sum);while(box.count)s+=pop(&box);printf("done %d\n",s);return 0;}
