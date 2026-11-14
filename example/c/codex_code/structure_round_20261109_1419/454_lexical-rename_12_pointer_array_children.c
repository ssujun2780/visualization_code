#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8555{int q8396,n;struct q8555*q8502[3];}q8555;
int walk(q8555*p){int s=p->q8396;for(int i=0;i<p->n;i++)s+=walk(p->q8502[i]);return s;}
int main(void){q8555 q7972={1,3,{0}},q8449={2,0,{0}},q8502={3,0,{0}},d={4,0,{0}};q7972.q8502[0]=&q8449;q7972.q8502[1]=&q8502;q7972.q8502[2]=&d;q8555*q7919=&q7972;
printf("%d\n",walk(q7919));return 0;}
