#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key;struct N*next[2];}N;
int main(void){N n[5]={{0,{0}},{2,{0}},{4,{0}},{6,{0}},{8,{0}}};for(int i=0;i<4;i++)n[i].next[0]=n+i+1;n[0].next[1]=n+2;n[2].next[1]=n+4;
N*head=n,*p=head;int key=7;for(int level=1;level>=0;level--)while(p->next[level]&&p->next[level]->key<key)p=p->next[level];
int sum=0;for(N*q=head->next[0];q;q=q->next[0])sum+=q->key;printf("%d %d\n",p->key,sum);return 0;}
