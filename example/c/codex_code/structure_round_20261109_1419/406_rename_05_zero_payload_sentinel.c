#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8555{struct q8555*q8290;int q8449;}q8555;
int main(void){q8555 q7919={0,99},q7972={0,0},q8025={0,7};q7919.q8290=&q7972;q7972.q8290=&q8025;q8025.q8290=&q7919;
int sum=0,count=0;for(q8555*p=q7919.q8290;p!=&q7919;p=p->q8290){sum+=p->q8449;count++;}
printf("%d %d\n",sum,count);return 0;}
