#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct{int value;size_t left,right;}N;typedef unsigned char Arena;
N*at(Arena*a,size_t offset){return offset?(N*)(void*)(a+offset):0;}
int sum(Arena*a,size_t p){N*n=at(a,p);return n?n->value+sum(a,n->left)+sum(a,n->right):0;}
int main(void){Arena *a=calloc(4,sizeof(N));if(!a)return 1;size_t x=sizeof(N),y=2*sizeof(N),z=3*sizeof(N);*at(a,x)=(N){4,y,z};*at(a,y)=(N){2,0,0};*at(a,z)=(N){6,0,0};printf("%d\n",sum(a,x));free(a);return 0;}
