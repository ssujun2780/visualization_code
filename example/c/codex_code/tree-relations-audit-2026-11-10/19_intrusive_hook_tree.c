#include <stdio.h>
#include <stddef.h>

typedef struct H{struct H*lo,*hi;}H;typedef struct{long cache;H hook;int value;}Item;
int visit(H*p){if(!p)return 0;Item*o=(Item*)((char*)p - offsetof(Item,hook));return o->value+visit(p->lo)+visit(p->hi);}
int main(void){Item a[5]={{0}};for(int i=0;i<5;i++)a[i].value=3;a[3].hook.lo=&a[0].hook;a[3].hook.hi=&a[4].hook;a[0].hook.hi=&a[1].hook;
H*root=&a[3].hook;printf("S0 %d\n",visit(root));return 0;}
