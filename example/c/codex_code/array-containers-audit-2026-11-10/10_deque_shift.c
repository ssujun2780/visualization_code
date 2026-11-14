#include <stdio.h>

typedef struct{int a[6];int n;}Box;
void back(Box*b,int x){b->a[b->n]=x;b->n++;}
void front(Box*b,int x){for(int k=b->n;k>0;k--)b->a[k]=b->a[k-1];b->a[0]=x;b->n++;}
int popback(Box*b){b->n--;return b->a[b->n];}
int popfront(Box*b){int x=b->a[0];for(int k=1;k<b->n;k++)b->a[k-1]=b->a[k];b->n--;return x;}
int main(void){Box q={0};back(&q,10);back(&q,20);front(&q,5);int x=popback(&q);front(&q,3);int y=popfront(&q);printf("S0 %d %d %d\n",x,y,q.n);return 0;}
