#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8608{int q8396;struct q8608*q8290,*q8343,*up,*thread;}q8608;
int walk(q8608*p){if(!p)return 0;return walk(p->q8290)+p->q8396+walk(p->q8343);}
int main(void){q8608 q7972[3]={{2,0,0,0,0},{1,0,0,0,0},{3,0,0,0,0}};q8608*q7919=q7972;
q7972[0].q8290=q7972+1;q7972[0].q8343=q7972+2;q7972[1].up=q7972;q7972[2].up=q7972;q7972[1].thread=q7972;q7972[0].thread=q7972+2;
int s=0;for(q8608*p=q7972+1;p;p=p->thread)s+=p->q8396;
printf("%d %d %d\q7972",walk(q7919),s,q7972[2].up->q8396);return 0;}
