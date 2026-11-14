#include <stdio.h>
#include <stdlib.h>

typedef struct N{struct N*p;int x;}N;N a[3],end;
N*last(N*p){while(p->p!=&end)p=p->p;return p;}
int main(void){for(int i=0;i<3;i++){a[i].x=i+1;a[i].p=i==2?&end:a+i+1;}printf("%d ",a[0].x+a[1].x+last(a)->x);return 0;}