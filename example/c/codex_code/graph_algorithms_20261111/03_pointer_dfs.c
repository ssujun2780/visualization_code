#include <stdio.h>

typedef struct P {int n,state;struct P* child[2];} P;
P nodes[5];int entered[5],finished[5],ni,nf;
void dfs(P*p){if(p->state)return;p->state=1;entered[ni++]=(int)(p-nodes);
for(int k=0;k<p->n;k++)dfs(p->child[k]);p->state=2;finished[nf++]=(int)(p-nodes);}
int main(void){nodes[0].child[0]=&nodes[1];nodes[0].child[1]=&nodes[2];nodes[0].n=2;
nodes[1].child[0]=&nodes[3];nodes[1].n=1;nodes[2].child[0]=&nodes[3];nodes[2].n=1;
nodes[3].child[0]=&nodes[0];nodes[3].n=1;
for(int i=0;i<5;i++)dfs(&nodes[i]);
printf("B %d %d %d %d %d / %d %d %d %d %d\n",entered[0],entered[1],entered[2],entered[3],entered[4],finished[0],finished[1],finished[2],finished[3],finished[4]);return 0;}
