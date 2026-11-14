#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct E E;struct E{int tag;union{int number;struct{E*q8237,*q8290;}args;}u;};
int eval(E*p){if(p->tag==0)return p->u.number;int q8396=eval(p->u.args.q8237),q8449=eval(p->u.args.q8290);return p->tag==1?q8396+q8449:q8396*q8449;}
int main(void){E x={0,{.number=3}},y={0,{.number=5}},add={1,{.args={&x,&y}}},mul={2,{.args={&add,&x}}};E*q7919=&mul;printf("%d\n",eval(q7919));return 0;}
