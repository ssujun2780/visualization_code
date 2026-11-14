#include <stdio.h>
#include <stdlib.h>
typedef struct N{int payload;struct N*aa,*zz;}N;int vals[5]={-6,1,8,-4,3},ls[5]={1,-1,3,4,-1},rs[5]={2,-1,-1,-1,-1};
int walk(N*p){if(!p)return 0;return p->payload+walk(p->aa)+walk(p->zz);}
int main(void){N*slots[5];N storage[5];for(int i=0;i<5;i++)slots[i]=storage+i;for(int i=0;i<5;i++){slots[i]->payload=vals[i];slots[i]->aa=ls[i]<0?0:slots[ls[i]];slots[i]->zz=rs[i]<0?0:slots[rs[i]];}N*entry=slots[0];printf("%d\n",walk(entry));return 0;}
