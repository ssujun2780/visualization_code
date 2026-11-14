#include <stdio.h>

typedef struct{int a[6];unsigned n;}Stack;
void push(Stack*s,int v){s->a[s->n++]=v;}
int pop(Stack*s){return s->a[--s->n];}
Stack in,out;
void put(int x){push(&in,x);}
int take(void){if(!out.n)while(in.n)push(&out,pop(&in));return pop(&out);}
int main(void){put(7);put(7);put(9);int x=take();put(8);int y=take();printf("S0 %d %d %u %u\n",x,y,in.n,out.n);return 0;}
