#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value;int next;}N;
int main(void){N pool[4]={{3,0},{5,0},{7,0},{9,-1}};for(int i=0;i<3;i++)pool[i].next=(i+1)*(int)sizeof(N);
int off=0,s=0;while(off>=0){N*p=(N*)((unsigned char*)pool+off);s+=p->value;off=p->next;}
printf("%d\n",s);return 0;}
