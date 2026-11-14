#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int *v;int n;} Box;
Box duplicate(Box a){Box b;b.n=a.n;b.v=malloc((size_t)b.n*sizeof *b.v);if(b.v)memcpy(b.v,a.v,(size_t)b.n*sizeof *b.v);return b;}
int main(void){int data[3]={2,4,6};Box a={data,3},b=duplicate(a);if(!b.v)return 1;Box alias=b;Box c=duplicate(b);if(!c.v){free(b.v);return 1;}alias.v[1]=9;c.v[2]=8;printf("%d %d %d %d\n",a.v[1],b.v[1],c.v[1],c.v[2]);free(b.v);free(c.v);return 0;}
