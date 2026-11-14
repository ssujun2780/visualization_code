#include <stdio.h>
typedef struct { int cell[6]; unsigned char occupied[6]; unsigned count; } Slots;
void put(Slots *s, unsigned k) {
    if (!s->occupied[k]) { s->cell[k] = 7; s->occupied[k] = 1; ++s->count; }
}
void erase(Slots *s, unsigned k) {
    if (s->occupied[k]) { s->occupied[k] = 0; --s->count; }
}
int main(void) {
    Slots s = {{0}, {0}, 0};
    put(&s, 4); put(&s, 1); put(&s, 5); erase(&s, 1);
    int sum = 0;
    for (unsigned i = 0; i < 6; ++i) if (s.occupied[i]) sum += s.cell[i];
    printf("%u %d %d\n", s.count, sum, s.cell[1]);
    return 0;
}
