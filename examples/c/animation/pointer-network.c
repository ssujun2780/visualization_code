#include <stdio.h>
#include <stdlib.h>

typedef struct Node Node;
struct Node { int value; Node *next; Node *other; int *payload; };

static void rewire(Node *base, Node **index, int count) {
    for (int i = 0; i < count; i += 7) {
        base[i].other = index[(i + 19) % count];
        index[i] = &base[(i + 2) % count];
    }
}

int main(void) {
    enum { COUNT = 48 };
    int values[COUNT];
    Node local[COUNT];
    Node *index[COUNT];
    Node **slots[COUNT];
    Node *heap = calloc(COUNT, sizeof *heap);
    if (!heap) return 1;
    for (int i = 0; i < COUNT; ++i) {
        values[i] = i * 3;
        local[i].value = i;
        local[i].next = &local[(i + 1) % COUNT];
        local[i].other = &heap[(i + 17) % COUNT];
        local[i].payload = &values[(i + 11) % COUNT];
        heap[i].next = &heap[(i + 1) % COUNT];
        heap[i].other = &local[(i + 23) % COUNT];
        heap[i].payload = &values[i];
        index[i] = &local[i];
        slots[i] = &index[i];
    }
    rewire(heap, index, COUNT);
    int sum = 0;
    for (int i = 0; i < COUNT; ++i) sum += *(*slots[i])->payload;
    printf("%d\n", sum);
    free(heap);
    return 0;
}
