#include <stdio.h>

#include <stdlib.h>
typedef struct{unsigned n,cap;int*data;}Box;
int put(Box*b,int v){if(b->n==b->cap){unsigned c=b->cap?b->cap*2:2;int*p=realloc(b->data,c*sizeof *p);if(!p)return 0;b->data=p;b->cap=c;}b->data[b->n++]=v;return 1;}
int take(Box*b){return b->data[--b->n];}
int main(void){Box q={0};if(!put(&q,4)||!put(&q,5)||!put(&q,6)){free(q.data);return 1;}
int x=take(&q);if(!put(&q,9)){free(q.data);return 1;}printf("S0 %d %u %u\n",x,q.n,q.cap);free(q.data);return 0;}
