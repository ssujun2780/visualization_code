typedef struct UnusedDeclaration { long double noise; int unrelated[17]; } UnusedDeclaration;
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*a,*b;}N;
int scan(N*p,int d){if(!p||d==0)return 0;return p->v+scan(p->a,d-1)+scan(p->b,d-1);}
int main(void){N n[4]={{1,0,0},{2,0,0},{3,0,0},{4,0,0}};N*root=n;
n[0].a=n+1;n[0].b=n+2;n[1].a=n+3;printf("tree %d\n",scan(root,3));
n[2].a=n+3;printf("dag %d\n",scan(root,3));
n[3].a=n;printf("cycle %d\n",scan(root,4));
n[3].a=0;n[2].a=0;printf("tree %d\n",scan(root,3));return 0;}
