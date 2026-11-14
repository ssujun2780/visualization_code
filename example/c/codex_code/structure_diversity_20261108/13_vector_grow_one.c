#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int*p,n,cap;}V;
int main(void){V v={0};int x[5]={3,1,4,1,5};for(int i=0;i<5;i++){if(v.n==v.cap){int*q=realloc(v.p,(v.cap+1)*sizeof*q);if(!q){free(v.p);return 1;}v.p=q;v.cap++;}v.p[v.n]=x[i];v.n++;}
 int total=0;for(int i=0;i<v.n;i++)total+=v.p[i];printf("%d %d %d\n",v.n,v.cap,total);free(v.p);return 0;}
