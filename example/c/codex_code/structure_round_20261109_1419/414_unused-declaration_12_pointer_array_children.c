typedef struct UnusedDeclaration { long double noise; int unrelated[17]; } UnusedDeclaration;
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v,n;struct N*c[3];}N;
int walk(N*p){int s=p->v;for(int i=0;i<p->n;i++)s+=walk(p->c[i]);return s;}
int main(void){N a={1,3,{0}},b={2,0,{0}},c={3,0,{0}},d={4,0,{0}};a.c[0]=&b;a.c[1]=&c;a.c[2]=&d;N*root=&a;
printf("%d\n",walk(root));return 0;}
