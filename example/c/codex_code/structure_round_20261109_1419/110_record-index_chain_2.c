#include <stdio.h>
#include <stdlib.h>
typedef struct{int payload,aa,zz;}N;int vals[2]={-6,1},ls[2]={1,-1},rs[2]={-1,-1};N storage[2];int walk(int k){if(k<0)return 0;return storage[k].payload+walk(storage[k].aa)+walk(storage[k].zz);}int main(void){for(int i=0;i<2;i++){storage[i].payload=vals[i];storage[i].aa=ls[i];storage[i].zz=rs[i];}printf("%d\n",walk(0));return 0;}
