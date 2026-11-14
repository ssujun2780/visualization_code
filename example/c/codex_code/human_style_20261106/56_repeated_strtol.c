#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){char s[]="17,-2,9";char*p=s;long total=0;int count=0;while(*p){char*end1;char*end2;long a=strtol(p,&end1,10);long b=strtol(p,&end2,10);if(end1!=end2)return 1;total+=a+b;count++;p=end1;if(*p==',')p++;}printf("%ld %d\n",total,count);return 0;}
