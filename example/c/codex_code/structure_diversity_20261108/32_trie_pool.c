#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int child[3],end;}N;
void put(N*t,int*used,const char*s){int u=0;while(*s){int c=*s++-'a';if(t[u].child[c]<0)t[u].child[c]=(*used)++;u=t[u].child[c];}t[u].end=1;}
int has(N*t,const char*s){int u=0;while(*s){int c=*s++-'a';if(t[u].child[c]<0)return 0;u=t[u].child[c];}return t[u].end;}
int main(void){N t[12];for(int i=0;i<12;i++){t[i].end=0;for(int j=0;j<3;j++)t[i].child[j]=-1;}int used=1;put(t,&used,"ab");put(t,&used,"ac");put(t,&used,"b");printf("%d %d %d\n",has(t,"ab"),has(t,"aa"),used);return 0;}
