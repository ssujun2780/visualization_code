#include <stdio.h>
typedef struct { int noise; int cell[6]; unsigned used; } Box;
void add(Box *b, int value) { b->cell[b->used++] = value; }
int take(Box *b) { return b->cell[--b->used]; }
int main(void) {
    Box b = {2, {0}, 0};
    add(&b, 11); add(&b, 22); add(&b, 33);
    int removed = take(&b);
    printf("%u %d %d %d %d\n", b.used, b.cell[0], b.cell[1], b.cell[2], removed);
    return 0;
}
