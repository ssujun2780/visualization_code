#include <stdio.h>
#include <stdlib.h>

typedef struct N{struct N*p;int x;}N;N a[4],end;
N*f(N*p){if(p->p==&end)return p;return p->p=f(p->p);}
void join(N*a,N*b){a=f(a);b=f(b);if(a!=b)b->p=a;}
int main(void){for(int i=0;i<4;i++){a[i].p=&end;a[i].x=i;}join(a,a+1);join(a+1,a+2);for(int i=0;i<4;i++)printf("%d ",f(a+i)->x);return 0;}