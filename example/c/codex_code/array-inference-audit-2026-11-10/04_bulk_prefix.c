#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct { unsigned noise, limit; int *base; unsigned used; } Box;
void append(Box *b, const int *source, unsigned count) {
    if (count <= b->limit - b->used) {
        memcpy(b->base + b->used, source, count * sizeof *source);
        b->used += count;
    }
}
int main(void) {
    Box b = {2, 6, NULL, 0}; int source[3] = {11, 22, 33};
    b.base = calloc(b.limit, sizeof *b.base);
    if (!b.base) return 1;
    append(&b, source, 3); --b.used;
    printf("%u %u %d %d %d\n", b.used, b.limit, b.base[0], b.base[1], b.base[2]);
    free(b.base);
    return 0;
}
