#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct N{struct N*parent,*a,*b;int payload;}N;int scan(N*p){if(!p)return 0;return p->payload+scan(p->a)+scan(p->b);}
int main(void){N storage[6]={0};N*pool[6];for(int i=0;i<6;i++)pool[i]=&storage[i];int v[6]={-1,12,-6,7,20,2};for(int i=0;i<6;i++){pool[i]->payload=v[i];if(2*i+1<6)pool[i]->a=pool[2*i+1];if(2*i+2<6)pool[i]->b=pool[2*i+2];if(i)pool[i]->parent=pool[(i-1)/2];}N*root=pool[0];printf("%d\n",scan(root));return 0;}
