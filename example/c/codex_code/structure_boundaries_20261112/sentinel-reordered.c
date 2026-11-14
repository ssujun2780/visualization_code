#include <stdio.h>
#include <stdlib.h>

typedef struct N{int x;struct N*p;}N;N a[4],boundary;
N*f(N*p){if(p->p!=&boundary)return p->p=f(p->p);return p;}
void unite(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<4;i++){a[i].p=&boundary;a[i].x=i;}unite(a,a+1);unite(a+1,a+2);for(int i=0;i<4;i++)printf("%d ",f(a+i)->x);return 0;}