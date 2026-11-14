#include <stdio.h>
#include <string.h>

typedef struct { int first; char marker; int last; } Cell;

void sparse(int *destination, const int *source, int count) {
    for (int k = 0; k < count; k += 2) destination[k] = source[k];
}
void touch(int *destination, const int *source) { destination[1] = source[0]; }
void unused(int *reference, int count) { int local = count + 1; (void)local; (void)reference; }
int token(void) { return 1; }

int main(void) {
    int original[6] = {9, 9, 9, 9, 9, 9};
    int other[6] = {0};
    sparse(other, original, 6);
    sparse(other + 1, original + 1, 4);
    touch(other + 1, original);
    unused(original, 6);
    int zero = 0;
    other[3] = original[3] + zero;
    other[5] = 9;
    int *alias = other;
    int temporary = *alias;
    other[4] = temporary;
    memmove(other + 1, other, 3 * sizeof(int));
    unsigned int wide[1] = {0};
    unsigned char narrow[1] = {0};
    wide[0] = (unsigned int)original[0];
    narrow[0] = (unsigned char)original[0];
    Cell cells[2] = {{1, 'A', 10}, {2, 'B', 20}};
    Cell mixed = {0};
    mixed.first = cells[0].first;
    mixed.last = cells[1].last;
    int single = token();
    printf("%d %d %d %d\n", other[3], mixed.first, mixed.last, single);
    return 0;
}
