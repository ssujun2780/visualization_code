#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int x;struct N*a,*b;}N;
int sum(N*p){return p?p->x+sum(p->a)+sum(p->b):0;}
int main(void){N n[4]={{1,0,0},{2,0,0},{3,0,0},{4,0,0}};n[0].a=&n[1];n[0].b=&n[2];n[1].a=&n[3];n[2].a=&n[3];N*root=n;printf("%d\n",sum(root));return 0;}

