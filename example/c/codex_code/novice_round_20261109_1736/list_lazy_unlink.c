#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int x,alive;struct N*next;}N;
int total(N*p){int s=0;while(p){if(p->alive)s+=p->x;p=p->next;}return s;}
int main(void){N a[5]={0};for(int i=0;i<5;i++){a[i].x=i+1;a[i].alive=1;a[i].next=i<4?a+i+1:0;}N*head=a;
a[1].alive=0;a[3].alive=0;printf("%d\n",total(head));a[0].next=a+2;a[2].next=a+4;printf("%d\n",total(head));return 0;}
