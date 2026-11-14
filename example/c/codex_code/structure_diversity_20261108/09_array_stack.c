#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],n;}S;
void push(S*s,int x){s->a[s->n++]=x;}int pop(S*s){return s->a[--s->n];}
int main(void){S s={0};push(&s,1);push(&s,2);push(&s,3);int n=0;while(s.n)n=n*10+pop(&s);printf("%d\n",n);return 0;}
