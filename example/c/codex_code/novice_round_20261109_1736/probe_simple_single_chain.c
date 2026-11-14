#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x;struct N*next;}N;int main(void){N a[4]={0};for(int i=0;i<4;i++){a[i].x=i+1;if(i<3)a[i].next=a+i+1;}N*head=a;int s=0;for(N*p=head;p;p=p->next)s+=p->x;printf("%d\n",s);return 0;}
