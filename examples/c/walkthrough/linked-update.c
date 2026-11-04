#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

int adjust(Node *head, int limit) {
    int total = 0;
    for (Node *p = head; p != NULL; p = p->next) {
        if (p->value >= limit && p->next != NULL) {
            p->value = p->value * 2 + 1;
        }
        total += p->value;
    }
    return total;
}

int main(void) {
    Node *nodes = calloc(3, sizeof *nodes);
    if (nodes == NULL) return 1;

    nodes[0].value = 3;
    nodes[1].value = 8;
    nodes[2].value = 5;
    nodes[0].next = &nodes[1];
    nodes[1].next = &nodes[2];
    nodes[2].next = NULL;

    int sum = adjust(nodes, 5);
    printf("%d %d %d | %d\n", nodes[0].value, nodes[1].value, nodes[2].value, sum);
    free(nodes);
    return 0;
}
