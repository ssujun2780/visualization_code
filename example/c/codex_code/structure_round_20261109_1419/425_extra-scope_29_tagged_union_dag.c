#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct E E;struct E{int tag;union{int number;struct{E*l,*r;}args;}u;};
int eval(E*p){if(p->tag==0)return p->u.number;int a=eval(p->u.args.l),b=eval(p->u.args.r);return p->tag==1?a+b:a*b;}
int main(void){{E x={0,{.number=3}},y={0,{.number=5}},add={1,{.args={&x,&y}}},mul={2,{.args={&add,&x}}};E*root=&mul;printf("%d\n",eval(root));return 0;}}
