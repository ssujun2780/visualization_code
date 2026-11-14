#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct V V;typedef struct E{V*to;struct E*next;}E;struct V{int id,value;E*edges;};
int main(void){V v[3]={{0,1,0},{1,2,0},{2,3,0}};E e[3]={{&v[1],0},{&v[2],0},{&v[2],0}};e[0].next=&e[1];v[0].edges=&e[0];v[1].edges=&e[2];
 V*q[3]={&v[0]};int seen[3]={1,0,0},h=0,t=1,sum=0;while(h<t){V*u=q[h++];sum+=u->value;for(E*p=u->edges;p;p=p->next)if(!seen[p->to->id]){seen[p->to->id]=1;q[t++]=p->to;}}
 printf("%d\n",sum);return 0;}
