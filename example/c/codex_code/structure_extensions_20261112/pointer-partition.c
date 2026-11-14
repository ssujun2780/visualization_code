#include <stdio.h>
typedef struct N {struct N *p; int id, r;} N;N a[5];
N *find(N*x){if(x->p==x)return x;return x->p=find(x->p);}
void unite(N*x,N*y){x=find(x);y=find(y);if(x==y)return;if(x->r<y->r){N*t=x;x=y;y=t;}y->p=x;if(x->r==y->r)x->r++;}
int main(void){for(int i=0;i<5;i++){a[i].p=a+i;a[i].id=i;}unite(a,a+1);unite(a+2,a+3);unite(a,a+2);for(int i=0;i<5;i++)printf("%d ",find(a+i)->id);return 0;}