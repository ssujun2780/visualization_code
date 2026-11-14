#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct Vertex Vertex;typedef struct Edge{Vertex*to;struct Edge*next;int cost;}Edge;struct Vertex{int value,seen;Edge*first;};
int main(void){Vertex v[3]={{0},{1},{2}};Edge e[4]={{&v[1],&e[1],2},{&v[2],0,7},{&v[2],0,3},{&v[0],0,1}};v[0].first=&e[0];v[1].first=&e[2];v[2].first=&e[3];Vertex*q[3];int head=0,tail=1,total=0;q[0]=&v[0];v[0].seen=1;while(head<tail){Vertex*p=q[head++];total+=p->value;for(Edge*a=p->first;a;a=a->next)if(!a->to->seen){a->to->seen=1;q[tail++]=a->to;}}printf("%d %d\n",total,tail);return 0;}
