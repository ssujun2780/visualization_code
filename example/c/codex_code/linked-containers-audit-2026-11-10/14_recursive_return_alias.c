#include <stdio.h>
#include <stdlib.h>
typedef struct N{int v;struct N*n;}N;
N*make(N*n){N*p=malloc(sizeof*p);if(p)*p=(N){7,n};return p;}
int total(N*p){return p?p->v+total(p->n):0;}
N*next(N*p){return p?p->n:0;}
int main(void){N*a=make(0),*b=make(a),*c=make(b);if(!a||!b||!c){free(c);free(b);free(a);return 1;}N*head=c;
printf("S0 %d\n",total(head));head=next(head);printf("S1 %d\n",total(head));free(c);free(b);free(a);return 0;}
