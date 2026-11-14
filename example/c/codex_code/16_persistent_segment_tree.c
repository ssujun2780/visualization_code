#include <stdio.h>
#include <stddef.h>

enum { MAX_ITEMS = 16, MAX_UPDATES = 16, MAX_NODES = 128 };
typedef struct Node Node;
struct Node {
    int sum;
    const Node *left;
    const Node *right;
};
typedef struct {
    Node nodes[MAX_NODES];
    size_t used;
} Arena;

static Node *make_node(Arena *arena, int sum, const Node *left, const Node *right) {
    if (arena->used == MAX_NODES) return NULL;
    Node *node = &arena->nodes[arena->used++];
    *node = (Node){sum, left, right};
    return node;
}

static const Node *build(Arena *arena, const int *values, int begin, int end) {
    if (end - begin == 1) return make_node(arena, values[begin], NULL, NULL);
    int middle = begin + (end - begin) / 2;
    const Node *left = build(arena, values, begin, middle);
    const Node *right = build(arena, values, middle, end);
    if (left == NULL || right == NULL) return NULL;
    return make_node(arena, left->sum + right->sum, left, right);
}

static const Node *update(Arena *arena, const Node *old, int begin, int end,
                          int position, int delta) {
    if (end - begin == 1) return make_node(arena, old->sum + delta, NULL, NULL);
    int middle = begin + (end - begin) / 2;
    const Node *left = old->left;
    const Node *right = old->right;
    if (position < middle) left = update(arena, left, begin, middle, position, delta);
    else right = update(arena, right, middle, end, position, delta);
    if (left == NULL || right == NULL) return NULL;
    return make_node(arena, left->sum + right->sum, left, right);
}

static int query(const Node *node, int begin, int end, int from, int to) {
    if (to <= begin || end <= from) return 0;
    if (from <= begin && end <= to) return node->sum;
    int middle = begin + (end - begin) / 2;
    return query(node->left, begin, middle, from, to)
         + query(node->right, middle, end, from, to);
}

int main(void) {
    int n, operations, values[MAX_ITEMS];
    Arena arena = {0};
    const Node *versions[MAX_UPDATES + 1] = {0};
    if (scanf("%d%d", &n, &operations) != 2 || n < 1 || n > MAX_ITEMS
        || operations < 1 || operations > MAX_UPDATES) return 1;
    for (int i = 0; i < n; ++i) {
        if (scanf("%d", &values[i]) != 1 || values[i] < -100 || values[i] > 100) return 1;
    }
    versions[0] = build(&arena, values, 0, n);
    if (versions[0] == NULL) return 1;
    for (int i = 0; i < operations; ++i) {
        int base, position, delta, from, to;
        if (scanf("%d%d%d%d%d", &base, &position, &delta, &from, &to) != 5
            || base < 0 || base > i || position < 0 || position >= n
            || delta < -100 || delta > 100 || from < 0 || from >= to || to > n) return 1;
        versions[i + 1] = update(&arena, versions[base], 0, n, position, delta);
        if (versions[i + 1] == NULL) return 1;
        printf("%d%c", query(versions[i + 1], 0, n, from, to),
               i + 1 == operations ? '\n' : ' ');
    }
    for (int i = 0; i <= operations; ++i) {
        printf("%d%c", query(versions[i], 0, n, 0, n), i == operations ? '\n' : ' ');
    }
    return 0;
}
