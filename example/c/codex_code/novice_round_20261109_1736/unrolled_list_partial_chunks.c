#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct C{int a[4],used;struct C*next;}C;
int main(void){C chunks[3]={{{2},1,0},{{3,5,7,11},4,0},{{13,17},2,0}};chunks[0].next=chunks+1;chunks[1].next=chunks+2;C*head=chunks;int n=0,sum=0;for(C*p=head;p;p=p->next)for(int i=0;i<p->used;i++){n++;sum+=p->a[i];}printf("%d %d\n",n,sum);chunks[1].a[1]=chunks[1].a[3];chunks[1].used--;n=0;for(C*p=head;p;p=p->next)n+=p->used;printf("%d\n",n);return 0;}
