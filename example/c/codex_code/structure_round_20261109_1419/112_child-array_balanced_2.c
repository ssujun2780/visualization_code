#include <stdio.h>
#include <stdlib.h>
typedef struct N{int payload;struct N*edge[2];}N;int vals[2]={-6,1},ls[2]={1,-1},rs[2]={-1,-1};int walk(N*p){if(!p)return 0;int s=p->payload;for(int i=0;i<2;i++)s+=walk(p->edge[i]);return s;}int main(void){N storage[2];for(int i=0;i<2;i++){storage[i].payload=vals[i];storage[i].edge[0]=ls[i]<0?0:storage+ls[i];storage[i].edge[1]=rs[i]<0?0:storage+rs[i];}N*entry=storage;printf("%d\n",walk(entry));return 0;}
