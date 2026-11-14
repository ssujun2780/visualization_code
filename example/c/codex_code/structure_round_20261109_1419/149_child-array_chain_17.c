#include <stdio.h>
#include <stdlib.h>
typedef struct N{int payload;struct N*edge[2];}N;int vals[17]={-6,1,8,-4,3,-9,-2,5,-7,0,7,-5,2,9,-3,4,-8},ls[17]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,-1},rs[17]={-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1};int walk(N*p){if(!p)return 0;int s=p->payload;for(int i=0;i<2;i++)s+=walk(p->edge[i]);return s;}int main(void){N storage[17];for(int i=0;i<17;i++){storage[i].payload=vals[i];storage[i].edge[0]=ls[i]<0?0:storage+ls[i];storage[i].edge[1]=rs[i]<0?0:storage+rs[i];}N*entry=storage;printf("%d\n",walk(entry));return 0;}
