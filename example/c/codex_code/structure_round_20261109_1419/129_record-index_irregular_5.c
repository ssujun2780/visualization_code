#include <stdio.h>
#include <stdlib.h>
typedef struct{int payload,aa,zz;}N;int vals[5]={-6,1,8,-4,3},ls[5]={1,-1,3,4,-1},rs[5]={2,-1,-1,-1,-1};N storage[5];int walk(int k){if(k<0)return 0;return storage[k].payload+walk(storage[k].aa)+walk(storage[k].zz);}int main(void){for(int i=0;i<5;i++){storage[i].payload=vals[i];storage[i].aa=ls[i];storage[i].zz=rs[i];}printf("%d\n",walk(0));return 0;}
