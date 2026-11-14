#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int edges[60],terminal[20],used=1;
void add(const char*s){int p=0;for(;*s;s++){int slot=p*3+*s-'a';if(!edges[slot])edges[slot]=used++;p=edges[slot];}terminal[p]=1;}
int find(const char*s){int p=0;for(;*s;s++){p=edges[p*3+*s-'a'];if(!p)return 0;}return terminal[p];}
int main(void){add("ab");add("ac");add("b");add("aba");printf("%d %d %d %d\n",used,find("ab"),find("a"),find("bc"));return 0;}
