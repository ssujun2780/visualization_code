#include <stdio.h>
#include <stdlib.h>
typedef struct N{int v;struct N*c[3];}N;
int visit(N*p){if(!p)return 0;int s=p->v;for(int j=0;j<3;j++)s+=visit(p->c[j]);return s;}
int main(void){N*slots[33];for(int i=0;i<33;i++){slots[i]=calloc(1,sizeof(N));if(!slots[i])return 1;}for(int i=0;i<33;i++){slots[i]->v=i%7;for(int j=0;j<3;j++){int k=3*i+j+1;slots[i]->c[j]=k<33?slots[k]:0;}}N*root=slots[0];for(int rep=0;rep<3;rep++)printf("%d %d\n",rep,visit(root));for(int i=0;i<33;i++)free(slots[i]);return 0;}
