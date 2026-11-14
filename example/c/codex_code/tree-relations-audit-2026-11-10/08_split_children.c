#include <stdio.h>

int walk(int*v,int*l,int*r,int p){return p<0?0:v[p]+walk(v,l,r,l[p])+walk(v,l,r,r[p]);}
int main(void){int v[8],l[8],r[8];for(int i=0;i<8;i++){v[i]=2;l[i]=r[i]=-7;}int root=6;
l[6]=1;r[6]=5;l[1]=0;r[1]=3;l[2]=4;printf("S0 %d\n",walk(v,l,r,root));
root=1;printf("S1 %d\n",walk(v,l,r,root));return 0;}
