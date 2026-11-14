#include <stdio.h>
#include <stdlib.h>
typedef struct N{int v;struct N*c[4];}N;
int visit(N*p){if(!p)return 0;int s=p->v;for(int j=0;j<4;j++)s+=visit(p->c[j]);return s;}
int main(void){N*slots[65];N storage[65]={0};for(int i=0;i<65;i++)slots[i]=storage+i;for(int i=0;i<65;i++){slots[i]->v=i%7;for(int j=0;j<4;j++){int k=4*i+j+1;slots[i]->c[j]=k<65?slots[k]:0;}}N*root=slots[0];for(int rep=0;rep<3;rep++)printf("%d %d\n",rep,visit(root));return 0;}
