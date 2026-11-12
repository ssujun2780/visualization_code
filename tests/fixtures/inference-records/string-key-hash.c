#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{const char*k;int v;struct N*next;}N;N nodes[2];N*b[3];
unsigned h(const char*s){unsigned x=0;while(*s)x=x*31+(unsigned char)*s++;return x%3;}
void put(int i,const char*k,int v){nodes[i].k=k;nodes[i].v=v;unsigned x=h(k);nodes[i].next=b[x];b[x]=nodes+i;}
int get(const char*k){for(N*p=b[h(k)];p;p=p->next)if(strcmp(k,p->k)==0)return p->v;return -1;}
int main(void){put(0,"ab",9);put(1,"bc",7);int x=get("ab"),y=get("bc");printf("%d %d\n",x,y);return 0;}