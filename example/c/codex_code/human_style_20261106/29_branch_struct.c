#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int a,b;} Pair;
Pair make(int x){Pair p={x,x+1};Pair copy=p;return copy;}
int main(void){int total=0;for(int i=0;i<4;i++){Pair p=(i%2)?make(i):make(i+2);Pair q=p;total+=q.a+q.b;}printf("%d\n",total);return 0;}
