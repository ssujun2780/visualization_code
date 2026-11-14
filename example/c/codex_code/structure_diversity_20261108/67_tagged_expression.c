#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N N;struct N{int tag;union{int value;struct{N*l,*r;}pair;}u;};
int eval(N*p){if(p->tag==0)return p->u.value;if(p->tag==1)return eval(p->u.pair.l)+eval(p->u.pair.r);return eval(p->u.pair.l)*eval(p->u.pair.r);}
int main(void){N a={.tag=0,.u.value=2},b={.tag=0,.u.value=3},c={.tag=0,.u.value=4},m={.tag=2,.u.pair={&b,&c}},s={.tag=1,.u.pair={&a,&m}};N*root=&s;printf("%d\n",eval(root));return 0;}
