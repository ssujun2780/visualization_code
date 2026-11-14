#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*l,*r;}N;
int sum(N*p){if(!p)return 0;return p->v+sum(p->l)+sum(p->r);}
int main(void){N leaf1={2,0,0},leaf2={3,0,0},old={1,&leaf1,&leaf2},fresh={7,0,0},newer=old;
newer.r=&fresh;N*versions[2]={&old,&newer};printf("%d %d\n",sum(versions[0]),sum(versions[1]));return 0;}
