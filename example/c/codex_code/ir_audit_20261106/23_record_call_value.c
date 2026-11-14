#include <stdio.h>
typedef struct {int a,b;} Item;
Item build(int n){Item x={n,n+2};return x;}
int use(Item x){return x.a+x.b;}
int main(void){int total=use(build(4));printf("%d\n",total);return 0;}
