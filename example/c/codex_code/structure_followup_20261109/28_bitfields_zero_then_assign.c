#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{unsigned color:1;unsigned weight:5;unsigned used:1;struct N*l,*r;}N;
unsigned visit(N*p){return p?(p->used?p->weight:0)+visit(p->l)+visit(p->r):0;}
int main(void){N a={.weight=3,.used=1},b={.weight=5,.used=1},r={0};r.color=1;r.weight=7;r.used=1;r.l=&a;r.r=&b;r.weight+=2;b.used=0;printf("%u %u %u\n",visit(&r),(unsigned)r.color,(unsigned)r.weight);return 0;}
