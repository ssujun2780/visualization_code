#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{unsigned a:3;unsigned b:5;} Flags;
int main(void){Flags f={1,3};int total=0;for(int i=0;i<4;i++){f.a+=1;f.b+=2;total+=f.a+f.b;f.b-=1;}printf("%u %u %d\n",f.a,f.b,total);return 0;}
