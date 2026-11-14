#include <stdio.h>
typedef struct N{int value;struct N*next;} N;
N* advance(N*p){return p->next;}
N* identity(N*p){return p;}
int total(N*p){int sum=0;for(;p;p=advance(p))sum+=p->value;return sum;}
int main(void){N a[3]={{5,&a[1]},{7,&a[2]},{9,0}};N*root=identity(a);printf("%d\n",total(root));return 0;}