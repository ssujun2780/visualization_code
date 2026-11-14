#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*next[2];}N;int main(void){N a[5]={0};for(int i=0;i<5;i++){a[i].x=i*2+1;if(i<4)a[i].next[0]=a+i+1;}a[0].next[1]=a+2;a[2].next[1]=a+4;N*head=a,*p=head;for(int level=1;level>=0;level--)while(p->next[level]&&p->next[level]->x<8)p=p->next[level];int s=0;for(N*q=head;q;q=q->next[0])s+=q->x;printf("%d %d\n",p->x,s);return 0;}
