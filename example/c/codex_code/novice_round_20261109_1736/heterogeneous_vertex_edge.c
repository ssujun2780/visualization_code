#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct V V;typedef struct E{V*dest;int weight;struct E*next;}E;struct V{int id,seen;E*head;V*parent;};
int main(void){V nodes[3]={0};E edges[4]={0};int u[4]={0,0,1,2},v[4]={1,2,2,0};for(int i=0;i<3;i++)nodes[i].id=10+i;for(int k=0;k<4;k++){edges[k].dest=nodes+v[k];edges[k].weight=k;edges[k].next=nodes[u[k]].head;nodes[u[k]].head=edges+k;}nodes[1].parent=nodes;nodes[2].parent=nodes;int n=0,sum=0;for(int i=0;i<3;i++)for(E*e=nodes[i].head;e;e=e->next){n++;sum+=e->dest->id+e->weight;}printf("%d %d\n",n,sum);return 0;}
