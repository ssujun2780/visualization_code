#include <stdio.h>
#include <stdlib.h>
typedef struct N{int payload;struct N*aa,*zz;}N;int vals[2]={-6,1},ls[2]={1,-1},rs[2]={-1,-1};
int walk(N*p){if(!p)return 0;return p->payload+walk(p->aa)+walk(p->zz);}
int main(void){N*slots[2];for(int i=0;i<2;i++){slots[i]=calloc(1,sizeof(N));if(!slots[i])return 1;}for(int i=0;i<2;i++){slots[i]->payload=vals[i];slots[i]->aa=ls[i]<0?0:slots[ls[i]];slots[i]->zz=rs[i]<0?0:slots[rs[i]];}N*entry=slots[0];printf("%d\n",walk(entry));for(int i=0;i<2;i++)free(slots[i]);return 0;}
