#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct N{int kind,value;struct N*a,*b;}N;
int eval(N*p){if(p->kind==0)return p->value;int x=eval(p->a),y=eval(p->b);return p->kind==1?x+y:x*y;}
int main(void){N a={0,2,0,0},b={0,3,0,0},sum={1,0,&a,&b},root={2,0,&sum,&sum};printf("%d\n",eval(&root));return 0;}
