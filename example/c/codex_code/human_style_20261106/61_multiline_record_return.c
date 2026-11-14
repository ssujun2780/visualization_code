#include <stdio.h>

typedef struct { int a, b; } Pair;
Pair make(int x) {
    Pair p = {x, x + 1};
    Pair copy = p;
    return copy;
}
int main(void) {
    Pair p = make(2);
    printf("%d %d\n", p.a, p.b);
    return 0;
}
