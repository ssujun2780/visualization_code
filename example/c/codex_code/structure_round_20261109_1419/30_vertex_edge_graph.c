#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct V V;typedef struct E{V*to;int w;struct E*next;}E;struct V{int id;E*edges;};
int main(void){V v[4]={{0,0},{1,0},{2,0},{3,0}};E e[5]={{v+1,0,0},{v+2,5,0},{v+2,2,0},{v+3,9,0},{v+3,1,0}};
v[0].edges=e;e[0].next=e+1;v[1].edges=e+2;e[2].next=e+3;v[2].edges=e+4;int d[4]={0,100,100,100};
for(int pass=0;pass<4;pass++)for(int i=0;i<4;i++)for(E*p=v[i].edges;p;p=p->next)if(d[p->to->id]>d[i]+p->w)d[p->to->id]=d[i]+p->w;
printf("%d %d %d %d\n",d[0],d[1],d[2],d[3]);return 0;}
