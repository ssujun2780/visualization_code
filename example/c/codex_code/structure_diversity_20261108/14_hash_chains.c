#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int k;struct N*next;}N;
int main(void){N*bucket[3]={0};N nodes[3]={{0,0},{3,0},{6,0}};for(int i=0;i<3;i++){int b=nodes[i].k%3;nodes[i].next=bucket[b];bucket[b]=&nodes[i];}
 int sum=0;for(int k=0;k<=6;k+=3){N*p=bucket[k%3];while(p&&p->k!=k)p=p->next;if(p)sum+=p->k;}
 printf("%d\n",sum);return 0;}
