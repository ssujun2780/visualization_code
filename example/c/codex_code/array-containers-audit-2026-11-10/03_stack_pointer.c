#include <stdio.h>

#include <stdlib.h>
short *b,*p,*end;
void put(short v){if(p<end){*p=v;p++;}}
short take(void){p--;return *p;}
int main(void){b=calloc(6,sizeof *b);if(!b)return 1;p=b;end=b+6;put(7);put(8);put(8);
short v=*(p-1),x=take(),y=take();printf("S0 %d %d %d %ld\n",v,x,y,(long)(p-b));free(b);return 0;}
