#include <stdio.h>
#include <stdlib.h>

typedef struct N{struct N*p;int x;}N;N a[3];
N*f(N*p){if(p->p==p)return p;return p->p=f(p->p);}
void join(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<3;i++){a[i].p=a+i;a[i].x=i;}join(a,a+1);for(int i=0;i<3;i++)printf("%d ",f(a+i)->x);for(int i=0;i<3;i++)a[i].p=a+i;for(int i=0;i<3;i++)printf("%d ",f(a+i)->x);return 0;}