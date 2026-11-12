#include <stdio.h>
#include <stdlib.h>
typedef struct { unsigned noise, limit; int *base; unsigned used; } Box;
void add(Box *b, int value) {
    if (b->used < b->limit) b->base[b->used++] = value;
}
int take(Box *b) { return b->base[--b->used]; }
int main(void) {
    Box b = {2, 6, NULL, 0};
    b.base = calloc(b.limit, sizeof *b.base);
    if (!b.base) return 1;
    add(&b, 11); add(&b, 22); add(&b, 33);
    int removed = take(&b);
    printf("%u %u %d %d %d %d\n", b.used, b.limit, b.base[0], b.base[1], b.base[2], removed);
    free(b.base);
    return 0;
}
