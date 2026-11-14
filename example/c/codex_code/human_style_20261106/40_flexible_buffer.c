#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int n;int values[];} Buffer;
Buffer* make(int n){Buffer*p=malloc(sizeof *p+(size_t)n*sizeof p->values[0]);if(!p)return NULL;p->n=n;for(int i=0;i<n;i++)p->values[i]=i+1;return p;}
int main(void){Buffer*a=make(4);if(!a)return 1;size_t bytes=sizeof *a+(size_t)a->n*sizeof a->values[0];Buffer*b=malloc(bytes);if(!b){free(a);return 1;}memcpy(b,a,bytes);b->values[2]+=7;int sum=0;for(int i=0;i<b->n;i++)sum+=b->values[i];printf("%d %d\n",a->values[2],sum);free(a);free(b);return 0;}
