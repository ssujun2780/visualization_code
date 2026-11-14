#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int key;struct N*next[3];}N;
N*find(N*h,int k){for(int level=2;level>=0;level--)while(h->next[level]&&h->next[level]->key<k)h=h->next[level];return h->next[0];}
int main(void){N a[6]={0};for(int i=0;i<6;i++)a[i].key=i*10;
for(int i=0;i<5;i++)a[i].next[0]=&a[i+1];a[0].next[1]=&a[2];a[2].next[1]=&a[4];a[0].next[2]=&a[4];
N*p=find(a,35);int sum=0;for(N*q=a[0].next[0];q;q=q->next[0])sum+=q->key;printf("%d %d\n",p->key,sum);return 0;}
