#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
#define SWAP(a,b) do { int saved=(a); (a)=(b); (b)=saved; } while(0)
#define MIX(a,b) (((a)+1)*((b)-2))
static int check(int x) { assert(x>0); return x; }
int main(void) {
    int a=3,b=9,hits=0;
    SWAP(a,b);
    int value=MIX(a,b); // @audit macro
    assert(++hits);
    assert(value || ++hits);
    printf("%d %d %d %d\n",a,b,check(value),hits);
    return 0;
}
