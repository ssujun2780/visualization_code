#include <stdio.h>

enum { DARK = 4, LIGHT = 9 };
typedef struct Node { int key; int shade; struct Node *lo, *hi; } Node;

int main(void) {
    Node nodes[3] = {{10, DARK, NULL, &nodes[1]},
                     {20, LIGHT, &nodes[2], NULL}, {15, LIGHT, NULL, NULL}};
    Node *root = &nodes[0];
    int seen[3] = {0};
    seen[0] = 1;
    Node *upper = root->hi;
    Node *middle = upper->lo;
    upper->lo = middle->hi;
    middle->hi = upper;
    root->hi = middle;
    Node *pivot = root->hi;
    root->hi = pivot->lo;
    pivot->lo = root;
    root = pivot;
    root->shade = DARK;
    root->lo->shade = LIGHT;
    seen[2] = 1;
    root->hi = NULL;
    printf("%d %d\n", root->key, root->lo->key);
    return 0;
}
