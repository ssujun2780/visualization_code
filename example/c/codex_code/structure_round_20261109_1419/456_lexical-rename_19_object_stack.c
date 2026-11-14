#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int*data;int count;}V;
int main(void){V q7919={0,0};for(int i=0;i<6;i++){int*p=realloc(q7919.data,(q7919.count+1)*sizeof(int));if(!p){free(q7919.data);return 1;}q7919.data=p;q7919.data[q7919.count++]=i*i;}
printf("full %d %d\n",q7919.count,q7919.data[5]);int s=0;while(q7919.count)s+=q7919.data[--q7919.count];printf("empty %d %d\n",q7919.count,s);free(q7919.data);return 0;}
