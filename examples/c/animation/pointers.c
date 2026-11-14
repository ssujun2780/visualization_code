#include <stdio.h>
#include <stdlib.h>

static int anchor = 123;
static int *global_pointer = &anchor;

static void redirect(int **slot, int *target) {
    *slot = target;
    **slot += 3;
}

int main(void) {
    int values[6] = {10, 20, 30, 40, 50, 60};
    int *first = &values[0];
    int *second = &values[3];
    int **indirect = &first;
    int ***third_level = &indirect;
    int *end = values + 6;
    end = values + 5;
    int *aliases[6] = {first, second, first, &values[2], &values[4], NULL};
    int *heap = calloc(6, sizeof *heap);
    if (!heap) return 1;
    aliases[5] = heap + 2;
    redirect(indirect, &values[5]);
    **third_level = &values[1];
    *aliases[5] = *first + *second;
    aliases[2] = aliases[5];
    aliases[0] = NULL;
    global_pointer = first;
    printf("%d %d\n", *first, heap[2]);
    free(heap);
    aliases[2] = aliases[5] = NULL;
    return 0;
}
