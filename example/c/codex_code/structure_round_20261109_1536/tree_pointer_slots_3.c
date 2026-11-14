#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct N{struct N*c[2];int payload;}N;int scan(N*p){if(!p)return 0;return p->payload+scan(p->c[0])+scan(p->c[1]);}
int main(void){N storage[3]={0};N*pool[3];for(int i=0;i<3;i++)pool[i]=&storage[i];int v[3]={-1,12,-6};for(int i=0;i<3;i++){pool[i]->payload=v[i];if(2*i+1<3)pool[i]->c[0]=pool[2*i+1];if(2*i+2<3)pool[i]->c[1]=pool[2*i+2];}N*root=pool[0];printf("%d\n",scan(root));return 0;}
