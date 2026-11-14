#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N N;struct N{int tag;union{int number;struct{N*a,*b;}pair;}u;};
int eval(N*p){return p->tag?eval(p->u.pair.a)+eval(p->u.pair.b):p->u.number;}
int main(void){N a={.tag=0,.u.number=4},b={.tag=0,.u.number=5},root={0};root.tag=1;root.u.pair.a=&a;root.u.pair.b=&b;
int first=eval(&root);root.tag=0;root.u.number=12;printf("%d %d\n",first,eval(&root));return 0;}
