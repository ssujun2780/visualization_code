#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key;struct N*next;}N;
int main(void){N nodes[5]={{1,0},{4,0},{2,0},{7,0},{5,0}};N*buckets[3]={0};
for(int i=0;i<5;i++){int h=nodes[i].key%3;nodes[i].next=buckets[h];buckets[h]=nodes+i;}
int s=0;for(int b=0;b<3;b++)for(N*p=buckets[b];p;p=p->next)s+=p->key;
printf("%d\n",s);return 0;}
