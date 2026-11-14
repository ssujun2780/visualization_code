#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
static int fib(int n) {
    if(n<2) return n;
    int left=fib(n-1);
    int right=fib(n-2);
    return left+right;
}
int main(void) {
    int n=0;
    if(scanf("%d",&n)!=1 || n<0 || n>12) return 1;
    int answer=fib(n); // @audit result
    printf("%d\n",answer);
    return 0;
}
