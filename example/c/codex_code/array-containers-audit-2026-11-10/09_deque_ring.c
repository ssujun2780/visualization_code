#include <stdio.h>

typedef struct{int a[5];unsigned h,n;}Box;
void back(Box*b,int v){b->a[(b->h+b->n)%5]=v;b->n++;}
void front(Box*b,int v){b->h=(b->h+4)%5;b->a[b->h]=v;b->n++;}
int popback(Box*b){int x=b->a[(b->h+b->n-1)%5];b->n--;return x;}
int popfront(Box*b){int x=b->a[b->h];b->h=(b->h+1)%5;b->n--;return x;}
int main(void){Box q={0};back(&q,10);back(&q,20);front(&q,5);int x=popback(&q);front(&q,3);int y=popfront(&q);printf("S0 %d %d %u\n",x,y,q.n);return 0;}
