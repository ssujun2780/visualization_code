#include <stdio.h>
#include <stdlib.h>
int *storage;
unsigned amount, bound;
int append(int value) {
    if (amount == bound) {
        unsigned grown = bound + 3;
        int *replacement = realloc(storage, grown * sizeof *storage);
        if (!replacement) return 0;
        storage = replacement; bound = grown;
    }
    storage[amount++] = value;
    return 1;
}
int main(void) {
    for (int i = 1; i <= 4; ++i) if (!append(i * 10)) { free(storage); return 1; }
    --amount;
    printf("%u %u %d %d %d %d\n", amount, bound, storage[0], storage[1], storage[2], storage[3]);
    free(storage);
    return 0;
}
