#include <stdio.h>
#include <stdlib.h>
typedef struct{int payload,aa,zz;}N;int vals[17]={-6,1,8,-4,3,-9,-2,5,-7,0,7,-5,2,9,-3,4,-8},ls[17]={1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,-1},rs[17]={-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1};N storage[17];int walk(int k){if(k<0)return 0;return storage[k].payload+walk(storage[k].aa)+walk(storage[k].zz);}int main(void){for(int i=0;i<17;i++){storage[i].payload=vals[i];storage[i].aa=ls[i];storage[i].zz=rs[i];}printf("%d\n",walk(0));return 0;}
