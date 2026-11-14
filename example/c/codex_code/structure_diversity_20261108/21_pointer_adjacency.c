#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct E{int to;struct E*next;}E;
int main(void){E e[4]={{1,0},{2,0},{3,0},{3,0}};e[0].next=&e[1];E*adj[4]={&e[0],&e[2],&e[3],0};
 int seen[4]={1,0,0,0},q[4]={0},h=0,t=1,sum=0;while(h<t){int u=q[h++];sum+=u;for(E*p=adj[u];p;p=p->next)if(!seen[p->to]){seen[p->to]=1;q[t++]=p->to;}}
 printf("%d\n",sum);return 0;}
