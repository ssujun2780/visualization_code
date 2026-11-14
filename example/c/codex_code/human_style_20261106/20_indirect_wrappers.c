#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int up(int x){return x+1;}int down(int x){return x-1;}
int apply(int(*f)(int),int x){int copy=x;return f(copy);}
int main(void){int total=0;for(int i=0;i<4;i++){int(*f)(int)=(i%2)?down:up;int a=apply(f,i);int b=apply(f,a);total+=b;}printf("%d\n",total);return 0;}
