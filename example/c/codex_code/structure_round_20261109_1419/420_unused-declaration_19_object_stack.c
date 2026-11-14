typedef struct UnusedDeclaration { long double noise; int unrelated[17]; } UnusedDeclaration;
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int*data;int count;}V;
int main(void){V v={0,0};for(int i=0;i<6;i++){int*p=realloc(v.data,(v.count+1)*sizeof(int));if(!p){free(v.data);return 1;}v.data=p;v.data[v.count++]=i*i;}
printf("full %d %d\n",v.count,v.data[5]);int s=0;while(v.count)s+=v.data[--v.count];printf("empty %d %d\n",v.count,s);free(v.data);return 0;}
