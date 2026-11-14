#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
int main(void) {
    int a=13, b=-4;
    int value=(a+b)*3-a/2; // @audit expression
    unsigned char byte=(unsigned char)260;
    unsigned int wrap=(unsigned int)-1;
    int seen=0;
    int ok=(value>10 && ++seen==1) || ++seen==4;
    printf("%d %u %u %d %d\n", value, (unsigned)byte, wrap, seen, ok);
    return 0;
}
