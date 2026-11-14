#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{struct N*up,*a,*b;int x;}N;
int sum(N*p){if(!p)return 0;return p->x+sum(p->a)+sum(p->b);}
int main(void){N n[3]={{0,0,0,1},{0,0,0,2},{0,0,0,3}};n[0].a=&n[1];n[0].b=&n[2];n[1].up=&n[0];n[2].up=&n[0];
 int check=n[1].up->x+n[2].up->x;if(check!=2)return 1;printf("%d\n",sum(n));return 0;}
