#include <stdio.h>
#include <stddef.h>
typedef struct L{struct L*n,*back;}L;typedef struct{int cache;L hook;int v;}Item;
int scan(L*p,int reverse){int s=0;while(p){Item*r=(Item*)((char*)p - offsetof(Item,hook));s+=r->v;p=reverse?p->back:p->n;}return s;}
int main(void){Item a[4]={{0}};for(int i=0;i<4;i++)a[i].v=5;a[2].hook.n=&a[0].hook;a[0].hook.back=&a[2].hook;
a[0].hook.n=&a[3].hook;a[3].hook.back=&a[0].hook;L*head=&a[2].hook,*tail=&a[3].hook;
printf("S0 %d %d\n",scan(head,0),scan(tail,1));return 0;}
