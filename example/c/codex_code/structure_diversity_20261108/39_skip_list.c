#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int key;struct N*next[3];}N;
int main(void){N head={0},n[4]={0};for(int i=0;i<4;i++){n[i].key=i+1;for(int l=0;l<3;l++)if((i+1)%(1<<l)==0){N*p=&head;while(p->next[l])p=p->next[l];p->next[l]=&n[i];}}
 N*p=&head;int target=3;for(int l=2;l>=0;l--)while(p->next[l]&&p->next[l]->key<target)p=p->next[l];p=p->next[0];int found=p&&p->key==target;
 int sum=0;for(p=head.next[0];p;p=p->next[0])sum+=p->key;printf("%d %d\n",found,sum);return 0;}
