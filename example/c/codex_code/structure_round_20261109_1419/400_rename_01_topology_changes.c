#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8608{int q8396;struct q8608*q8449,*q8502;}q8608;
int scan(q8608*p,int d){if(!p||d==0)return 0;return p->q8396+scan(p->q8449,d-1)+scan(p->q8502,d-1);}
int main(void){q8608 q7972[4]={{1,0,0},{2,0,0},{3,0,0},{4,0,0}};q8608*q7919=q7972;
q7972[0].q8449=q7972+1;q7972[0].q8502=q7972+2;q7972[1].q8449=q7972+3;printf("tree %d\q7972",scan(q7919,3));
q7972[2].q8449=q7972+3;printf("dag %d\q7972",scan(q7919,3));
q7972[3].q8449=q7972;printf("cycle %d\q7972",scan(q7919,4));
q7972[3].q8449=0;q7972[2].q8449=0;printf("tree %d\q7972",scan(q7919,3));return 0;}
