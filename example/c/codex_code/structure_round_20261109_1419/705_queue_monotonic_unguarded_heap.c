#include <stdio.h>
#include <stdlib.h>
typedef struct{int*data;int count,head,tail,cap;}Q;
void push(Q*q,int x){q->data[q->tail%5]=x;q->tail++;q->count++;}
int pop(Q*q){int x=q->data[q->head%5];q->head++;q->count--;return x;}
int main(void){Q box={0,0,0,0,5};box.data=calloc(box.cap,sizeof(int));if(!box.data)return 1;
push(&box,11);push(&box,22);push(&box,33);int s=pop(&box);push(&box,44);push(&box,55);int sum=0;for(int i=0;i<box.count;i++)sum+=box.data[(box.head+i)%5];
printf("active %d %d\n",box.count,sum);while(box.count)s+=pop(&box);printf("done %d\n",s);free(box.data);return 0;}
