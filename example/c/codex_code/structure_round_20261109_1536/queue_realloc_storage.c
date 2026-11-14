#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct {int*d;int n,cap;} Q;
void push(Q*q,int x){if(q->n==q->cap){int cap=q->cap*2;int*p=realloc(q->d,(size_t)cap*sizeof(int));if(!p)exit(1);q->d=p;q->cap=cap;}q->d[q->n++]=x;}
int pop(Q*q){int x=q->d[0];for(int i=1;i<q->n;i++)q->d[i-1]=q->d[i];q->n--;return x;}
int main(void){Q q={malloc(2*sizeof(int)),0,2};if(!q.d)return 1;
 push(&q,7);push(&q,2);printf("%d\n",pop(&q));
 push(&q,9);push(&q,3);push(&q,8);printf("%d\n",pop(&q));
 int total=0;while(q.n)total+=pop(&q);printf("%d\n",total);free(q.d);return 0;}

