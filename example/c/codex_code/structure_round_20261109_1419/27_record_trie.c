#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int child[3],end;}Node;Node pool[20];int used=1;
void add(const char*s){int p=0;for(;*s;s++){int k=*s-'a';if(!pool[p].child[k])pool[p].child[k]=used++;p=pool[p].child[k];}pool[p].end=1;}
int find(const char*s){int p=0;for(;*s;s++){p=pool[p].child[*s-'a'];if(!p)return 0;}return pool[p].end;}
int main(void){add("ab");add("ac");add("b");add("aba");printf("%d %d %d %d\n",used,find("ab"),find("a"),find("bc"));return 0;}
