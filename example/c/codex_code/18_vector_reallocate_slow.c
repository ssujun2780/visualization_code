#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct{int*data;size_t size,capacity;} Vector;
static int append(Vector*v,int x){int*next=realloc(v->data,(v->size+1)*sizeof*next);if(!next)return 0;v->data=next;v->capacity=v->size+1;v->data[v->size++]=x;return 1;}
int main(void){int n;Vector v={0};if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!append(&v,x)){free(v.data);return 1;}
  int*copy=malloc(v.size*sizeof*copy);if(!copy){free(v.data);return 1;}memcpy(copy,v.data,v.size*sizeof*copy);memcpy(v.data,copy,v.size*sizeof*copy);free(copy);
 }for(size_t i=0;i<v.size;i++){printf("%d%c",v.data[i],i+1==v.size?'\n':' ');}free(v.data);return 0;}
