#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct { int first,second; } Pair;
static Pair make(int x) { return (Pair){x,x+4}; }
int main(void) { Pair answer=make(7); printf("%d %d\n",answer.first,answer.second); return 0; }
