#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*l,*r;}N;
int sum(N*p){return p?p->v+sum(p->l)+sum(p->r):0;}
int main(void){N a={1,0,0},b={3,0,0},r1={2,&a,&b},c={4,0,0},b2={3,0,&c},r2={2,&a,&b2};N*versions[2]={&r1,&r2};
 int results[2];for(int i=0;i<2;i++)results[i]=sum(versions[i]);printf("%d %d\n",results[0],results[1]);return 0;}
