#include <stdio.h>
#include <stdlib.h>

typedef struct N{int v;struct N*next;}N;int sum(N*p){int s=0;while(p){s+=p->v;p=p->next;}return s;}
int main(void){N x={2,0},y={3,0},z={5,0},w={7,0};x.next=&z;y.next=&z;N*roots[2]={&x,&y};printf("shared %d %d\n",sum(roots[0]),sum(roots[1]));y.next=&w;printf("separate %d %d\n",sum(roots[0]),sum(roots[1]));return 0;}
