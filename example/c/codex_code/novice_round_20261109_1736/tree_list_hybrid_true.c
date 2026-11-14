#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*a,*b,*next;}N;
int tree(N*p){return p?p->x+tree(p->a)+tree(p->b):0;}
int chain(N*p){int s=0;while(p){s+=p->x;p=p->next;}return s;}
int main(void){N pool[5]={0};for(int i=0;i<5;i++)pool[i].x=i+1;pool[0].a=pool+1;pool[0].b=pool+2;pool[1].a=pool+3;pool[1].b=pool+4;
int order[5]={3,1,4,0,2};for(int i=0;i<4;i++)pool[order[i]].next=pool+order[i+1];N*root=pool,*head=pool+3;
printf("%d %d\n",tree(root),chain(head));pool[2].next=head;int n=0;N*q=head;do{n++;q=q->next;}while(q!=head);printf("%d\n",n);return 0;}
