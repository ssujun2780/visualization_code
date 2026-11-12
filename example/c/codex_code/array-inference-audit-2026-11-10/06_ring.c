#include <stdio.h>
typedef struct { int noise; int cell[5]; unsigned h, n; } Ring;
void add(Ring *r, int value) { r->cell[(r->h + r->n) % 5] = value; r->n++; }
int take(Ring *r) { int value = r->cell[r->h]; r->h = (r->h + 1) % 5; r->n--; return value; }
int main(void) {
    Ring r = {4, {0}, 0, 0};
    add(&r, 10); add(&r, 20); add(&r, 30); add(&r, 40);
    take(&r); take(&r); add(&r, 50); add(&r, 60);
    printf("live %u %u %d %d %d %d\n", r.h, r.n, r.cell[2], r.cell[3], r.cell[4], r.cell[0]);
    int total = 0;
    while (r.n) total += take(&r);
    printf("empty %u %u %d\n", r.h, r.n, total);
    return 0;
}
