#include <stdio.h>
#include <string.h>

typedef struct Item Item;
struct Item { int value; Item *next; int *payload[2]; };
typedef struct { Item *node; int **slot; int *entries[3]; } Holder;

int main(void) {
    int grid[3][3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
    int (*row)[3] = grid;
    int *ports[2][3] = {{&grid[0][0], &grid[1][1], &grid[2][2]}, {&grid[0][2], &grid[1][0], &grid[2][1]}};
    int *(*port_row)[3] = ports;
    Item items[4] = {0};
    for (int i = 0; i < 4; ++i) {
        items[i].value = i + 10;
        items[i].next = &items[(i + 1) % 4];
        items[i].payload[0] = ports[i % 2][0];
        items[i].payload[1] = &grid[i % 3][2];
    }
    Holder holders[2] = {{&items[0], &ports[0][0], {ports[0][0], ports[0][1], ports[0][2]}}, {0}};
    memcpy(&holders[1], &holders[0], sizeof holders[0]);
    holders[1].node = &items[3];
    holders[1].entries[1] = &row[2][0];
    port_row[1][2] = holders[1].entries[1];
    *holders[0].slot = items[2].payload[1];
    printf("%d %d\n", *ports[0][0], *ports[1][2]);
    return 0;
}
