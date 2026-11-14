#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Entry{int child[2],terminal,pass;}Node;Node pool[16];int used=1;
void add(const char*s){int p=0;pool[p].pass++;for(;*s;s++){int k=*s-'a';if(pool[p].child[k]==0)pool[p].child[k]=used++;p=pool[p].child[k];pool[p].pass++;}pool[p].terminal++;}
int main(void){add("a");add("ab");add("b");add("ba");int a=pool[0].child[0],b=pool[0].child[1];printf("%d %d %d %d\n",used,pool[0].pass,pool[a].pass,pool[b].pass);return 0;}
