#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*n;}N;
int main(void){N*h=0;for(int i=1;i<=4;i++){int*scratch=malloc(2*sizeof *scratch);if(!scratch)return 1;scratch[0]=i;scratch[1]=i;
 N*x=calloc(1,sizeof*x);if(!x){free(scratch);return 1;}x->v=scratch[1];free(scratch);
 if(!h)h=x;else{N*t=h;while(t->n)t=t->n;t->n=x;}}
 int out=0;while(h){N*t=h;out=out*10+t->v;h=t->n;free(t);}printf("%d\n",out);return 0;}
