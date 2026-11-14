#include <stdio.h>
#include <stdlib.h>
typedef struct N{int payload;struct N*aa,*zz;}N;int vals[17]={-6,1,8,-4,3,-9,-2,5,-7,0,7,-5,2,9,-3,4,-8},ls[17]={1,4,3,8,11,12,7,-1,9,-1,-1,-1,16,-1,-1,-1,-1},rs[17]={2,6,5,15,13,14,-1,-1,10,-1,-1,-1,-1,-1,-1,-1,-1};
int walk(N*p){if(!p)return 0;return p->payload+walk(p->aa)+walk(p->zz);}
int main(void){N*slots[17];N storage[17];for(int i=0;i<17;i++)slots[i]=storage+i;for(int i=0;i<17;i++){slots[i]->payload=vals[i];slots[i]->aa=ls[i]<0?0:slots[ls[i]];slots[i]->zz=rs[i]<0?0:slots[rs[i]];}N*entry=slots[0];printf("%d\n",walk(entry));return 0;}
