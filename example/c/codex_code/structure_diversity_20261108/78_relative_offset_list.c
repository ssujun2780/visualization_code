#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int value,next;}N;
int main(void){N*a=calloc(4,sizeof*a);if(!a)return 1;int order[4]={0,2,3,1};for(int i=0;i<4;i++){a[order[i]].value=i+1;a[order[i]].next=i==3?-1:(int)(order[i+1]*sizeof*a);}
 unsigned char*base=(unsigned char*)a;int at=0,sum=0;while(at!=-1){N*p=(N*)(base+at);sum+=p->value;at=p->next;}
 printf("%d\n",sum);free(a);return 0;}
