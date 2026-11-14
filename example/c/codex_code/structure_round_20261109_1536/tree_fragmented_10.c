#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct N{struct N*a,*b;int payload;}N;int scan(N*p){if(!p)return 0;return p->payload+scan(p->a)+scan(p->b);}
int main(void){N*pool[10];for(int i=0;i<10;i++){pool[i]=calloc(1,sizeof(N));if(!pool[i])return 1;}int v[10]={-1,12,-6,7,20,2,15,-3,10,-8};for(int i=0;i<10;i++){pool[i]->payload=v[i];if(2*i+1<10)pool[i]->a=pool[2*i+1];if(2*i+2<10)pool[i]->b=pool[2*i+2];}N*root=pool[0];printf("%d\n",scan(root));for(int i=0;i<10;i++)free(pool[i]);return 0;}
