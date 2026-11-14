#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int visits=0;int fib(int n){visits++;if(n<2)return n;int left=fib(n-1);int right=fib(n-2);int answer=left+right;return answer;}
int main(void){int answer=fib(7);printf("%d %d\n",answer,visits);return 0;}
