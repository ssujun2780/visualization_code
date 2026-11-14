#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
#include <assert.h>
typedef enum { Black, Red } Color;
typedef struct Node Node;
struct Node { int key; Color color; Node *left, *right, *parent; };
typedef struct { Node *root; Node nil; size_t length; } Tree;
static void init(Tree *t) {
    t->nil = (Node){.key = 0, .color = Black,
        .left = &t->nil, .right = &t->nil, .parent = &t->nil};
    t->root = &t->nil;
    t->length = 0;
}
static void rotateLeft(Tree *t, Node *x) {
    Node *y = x->right;
    assert(y != &t->nil);
    x->right = y->left;
    if (y->left != &t->nil) y->left->parent = x;
    y->parent = x->parent;
    if (x->parent == &t->nil) t->root = y;
    else if (x == x->parent->left) x->parent->left = y;
    else x->parent->right = y;
    y->left = x;
    x->parent = y;
}
static void rotateRight(Tree *t, Node *x) {
    Node *y = x->left;
    assert(y != &t->nil);
    x->left = y->right;
    if (y->right != &t->nil) y->right->parent = x;
    y->parent = x->parent;
    if (x->parent == &t->nil) t->root = y;
    else if (x == x->parent->right) x->parent->right = y;
    else x->parent->left = y;
    y->right = x;
    x->parent = y;
}
static void repairInsert(Tree *t, Node *z) {
    while (z->parent->color == Red) {
        if (z->parent == z->parent->parent->left) {
            Node *y = z->parent->parent->right;
            if (y->color == Red) {
                z->parent->color = Black; y->color = Black;
                z->parent->parent->color = Red; z = z->parent->parent;
            } else {
                if (z == z->parent->right) { z = z->parent; rotateLeft(t, z); }
                z->parent->color = Black; z->parent->parent->color = Red;
                rotateRight(t, z->parent->parent);
            }
        } else {
            Node *y = z->parent->parent->left;
            if (y->color == Red) {
                z->parent->color = Black; y->color = Black;
                z->parent->parent->color = Red; z = z->parent->parent;
            } else {
                if (z == z->parent->left) { z = z->parent; rotateRight(t, z); }
                z->parent->color = Black; z->parent->parent->color = Red;
                rotateLeft(t, z->parent->parent);
            }
        }
    }
    t->root->color = Black;
}
static int insert(Tree *t, int key) {
    Node *parent = &t->nil, *current = t->root;
    while (current != &t->nil) {
        parent = current;
        if (key == current->key) return 2;
        current = key < current->key ? current->left : current->right;
    }
    Node *z = malloc(sizeof *z);
    if (!z) return 0;
    *z = (Node){.key = key, .color = Red,
        .left = &t->nil, .right = &t->nil, .parent = parent};
    if (parent == &t->nil) t->root = z;
    else if (key < parent->key) parent->left = z;
    else parent->right = z;
    ++t->length;
    repairInsert(t, z);
    return 1;
}
static void transplant(Tree *t, Node *u, Node *v) {
    if (u->parent == &t->nil) t->root = v;
    else if (u == u->parent->left) u->parent->left = v;
    else u->parent->right = v;
    v->parent = u->parent;
}
static void repairErase(Tree *t, Node *x) {
    while (x != t->root && x->color == Black) {
        if (x == x->parent->left) {
            Node *w = x->parent->right;
            assert(w != &t->nil);
            if (w->color == Red) {
                w->color = Black; x->parent->color = Red;
                rotateLeft(t, x->parent); w = x->parent->right;
            }
            if (w->left->color == Black && w->right->color == Black) {
                w->color = Red; x = x->parent;
            } else {
                if (w->right->color == Black) {
                    w->left->color = Black; w->color = Red;
                    rotateRight(t, w); w = x->parent->right;
                }
                w->color = x->parent->color; x->parent->color = Black;
                w->right->color = Black; rotateLeft(t, x->parent); x = t->root;
            }
        } else {
            Node *w = x->parent->left;
            assert(w != &t->nil);
            if (w->color == Red) {
                w->color = Black; x->parent->color = Red;
                rotateRight(t, x->parent); w = x->parent->left;
            }
            if (w->right->color == Black && w->left->color == Black) {
                w->color = Red; x = x->parent;
            } else {
                if (w->left->color == Black) {
                    w->right->color = Black; w->color = Red;
                    rotateLeft(t, w); w = x->parent->left;
                }
                w->color = x->parent->color; x->parent->color = Black;
                w->left->color = Black; rotateRight(t, x->parent); x = t->root;
            }
        }
    }
    x->color = Black;
}
static int erase(Tree *t, int key) {
    Node *z = t->root;
    while (z != &t->nil && z->key != key)
        z = key < z->key ? z->left : z->right;
    if (z == &t->nil) return 0;
    Node *y = z, *x;
    Color previous = y->color;
    if (z->left == &t->nil) { x = z->right; transplant(t, z, z->right); }
    else if (z->right == &t->nil) { x = z->left; transplant(t, z, z->left); }
    else {
        y = z->right;
        while (y->left != &t->nil) y = y->left;
        previous = y->color;
        x = y->right;
        if (y->parent == z) x->parent = y;
        else {
            transplant(t, y, y->right);
            y->right = z->right; y->right->parent = y;
        }
        transplant(t, z, y);
        y->left = z->left; y->left->parent = y; y->color = z->color;
    }
    free(z);
    --t->length;
    if (previous == Black) repairErase(t, x);
    t->nil.parent = &t->nil;
    return 1;
}
static int checkNode(const Tree *t, const Node *n, long long low,
                     long long high, size_t *count) {
    if (n == &t->nil) return 1;
    if ((long long)n->key <= low || (long long)n->key >= high) return -1;
    if (n->color != Black && n->color != Red) return -1;
    if (n->left != &t->nil && n->left->parent != n) return -1;
    if (n->right != &t->nil && n->right->parent != n) return -1;
    if (n->color == Red && (n->left->color == Red || n->right->color == Red)) return -1;
    int a = checkNode(t, n->left, low, n->key, count);
    int b = checkNode(t, n->right, n->key, high, count);
    if (a < 0 || b < 0 || a != b) return -1;
    ++*count;
    return a + (n->color == Black);
}
static int valid(const Tree *t) {
    size_t count = 0;
    if (t->nil.color != Black || t->nil.left != &t->nil || t->nil.right != &t->nil) return 0;
    if (t->root != &t->nil && (t->root->parent != &t->nil || t->root->color != Black)) return 0;
    int height = checkNode(t, t->root, LLONG_MIN, LLONG_MAX, &count);
    return height > 0 && count == t->length;
}
static void destroyNode(Tree *t, Node *n) {
    if (n == &t->nil) return;
    destroyNode(t, n->left); destroyNode(t, n->right); free(n);
}
static void destroy(Tree *t) { destroyNode(t, t->root); init(t); }

static const Node *lookup(const Tree *t, int key) {
    const Node *p = t->root;
    while (p != &t->nil && p->key != key)
        p = key < p->key ? p->left : p->right;
    return p;
}
static const Node *extreme(const Tree *t, int direction) {
    const Node *p = t->root;
    if (p == &t->nil) return p;
    if (direction < 0) {
        while (p->left != &t->nil) p = p->left;
    } else {
        while (p->right != &t->nil) p = p->right;
    }
    return p;
}
static const Node *neighbor(const Tree *t, int key, int direction, int equal) {
    const Node *p = t->root, *best = &t->nil;
    while (p != &t->nil) {
        if (direction < 0) {
            if (p->key < key) { best = p; p = p->right; }
            else p = p->left;
        } else {
            if (p->key > key || (equal && p->key == key)) { best = p; p = p->left; }
            else p = p->right;
        }
    }
    return best;
}
static void printKeys(const Tree *t, const Node *p) {
    if (p == &t->nil) return;
    printKeys(t, p->left);
    printf(" %d", p->key);
    printKeys(t, p->right);
}
static void printNodes(const Tree *t, const Node *p) {
    if (p == &t->nil) return;
    printNodes(t, p->left);
    printf("N %d %u %d %d %d %d %d %d\n", p->key, (unsigned)p->color,
           p->left != &t->nil, p->left != &t->nil ? p->left->key : 0,
           p->right != &t->nil, p->right != &t->nil ? p->right->key : 0,
           p->parent != &t->nil, p->parent != &t->nil ? p->parent->key : 0);
    printNodes(t, p->right);
}
static int apply(Tree *t, char operation, int key, size_t step, int details) {
    int status = 0, result = 0;
    const Node *p = &t->nil;
    switch (operation) {
        case '+':
            status = insert(t, key);
            if (!status) { fputs("ERROR\n", stderr); return 0; }
            result = key;
            break;
        case '-':
            status = erase(t, key);
            if (status) result = key;
            break;
        case '?': p = lookup(t, key); break;
        case '<': p = neighbor(t, key, -1, 0); break;
        case '>': p = neighbor(t, key, 1, 0); break;
        case '=': p = neighbor(t, key, 1, 1); break;
        case 'm': p = extreme(t, -1); break;
        case 'M': p = extreme(t, 1); break;
        case 'r':
            if (t->root != &t->nil) {
                result = t->root->key;
                status = erase(t, result);
            }
            break;
        case 'c':
            if (t->length > (size_t)INT_MAX) { fputs("ERROR\n", stderr); return 0; }
            result = (int)t->length;
            destroy(t);
            status = 1;
            break;
        case 'p': status = 1; break;
        default: fputs("ERROR\n", stderr); return 0;
    }
    if (p != &t->nil) { status = 1; result = p->key; }
    int consistent = valid(t);
    if (!consistent) { fputs("ERROR\n", stderr); return 0; }
    printf("S %zu %c %d %d %d %zu %d", step, operation, key, status,
           result, t->length, consistent);
    printKeys(t, t->root);
    putchar('\n');
    if (details) {
        printf("T %d %d\n", t->root != &t->nil,
               t->root != &t->nil ? t->root->key : 0);
        printNodes(t, t->root);
    }
    return 1;
}
static int parse(char *line, char *operation, int *key) {
    char *p = line;
    while (isspace((unsigned char)*p)) ++p;
    if (!*p) return 0;
    *operation = *p++;
    *key = 0;
    if (*operation == '+' || *operation == '-' || *operation == '?' ||
        *operation == '<' || *operation == '>' || *operation == '=') {
        while (isspace((unsigned char)*p)) ++p;
        if (!*p) return -1;
        errno = 0;
        char *end;
        long number = strtol(p, &end, 10);
        if (end == p || errno == ERANGE || number < INT_MIN || number > INT_MAX) return -1;
        *key = (int)number;
        p = end;
    } else if (!strchr("mMrcpq", *operation)) return -1;
    while (isspace((unsigned char)*p)) ++p;
    return *p ? -1 : 1;
}
int main(int argc, char **argv) {
    int interactive = 0, details = 0;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--interactive") == 0) interactive = 1;
        else if (strcmp(argv[i], "--dump") == 0) details = 1;
        else if (strcmp(argv[i], "--help") == 0) {
            puts("+ n | - n | ? n | < n | > n | = n | m | M | r | c | p | q");
            return 0;
        } else { fputs("ERROR\n", stderr); return 2; }
    }
    Tree t;
    init(&t);
    int exitCode = 0;
    size_t step = 0;
    if (interactive) {
        char line[128];
        while (fgets(line, sizeof line, stdin)) {
            if (!strchr(line, '\n') && !feof(stdin)) {
                fputs("ERROR\n", stderr); exitCode = 2; break;
            }
            char operation;
            int key;
            int status = parse(line, &operation, &key);
            if (!status) continue;
            if (status < 0) { fputs("ERROR\n", stderr); exitCode = 2; break; }
            if (operation == 'q') break;
            if (step == SIZE_MAX) { fputs("ERROR\n", stderr); exitCode = 2; break; }
            if (!apply(&t, operation, key, ++step, details)) { exitCode = 1; break; }
        }
        if (ferror(stdin)) { fputs("ERROR\n", stderr); exitCode = 2; }
    } else {
        const struct { char operation; int key; } operations[] = {
            {'p', 0},
            {'+', 10},
            {'+', 20},
            {'+', 30},
            {'+', 15},
            {'+', 25},
            {'+', 5},
            {'+', 1},
            {'?', 15},
            {'?', 99},
            {'m', 0},
            {'M', 0},
            {'<', 15},
            {'>', 15},
            {'=', 16},
            {'+', 15},
            {'r', 0},
            {'-', 1},
            {'-', 5},
            {'+', 12},
            {'+', 18},
            {'+', 40},
            {'-', 99},
            {'-', 25},
            {'p', 0},
            {'c', 0},
            {'m', 0},
            {'M', 0},
            {'-', 10},
            {'+', 7},
            {'r', 0},
            {'+', 7},
            {'c', 0},
            {'c', 0},
        };
        for (size_t i = 0; i < sizeof operations / sizeof operations[0]; ++i) {
            if (!apply(&t, operations[i].operation, operations[i].key, ++step, details)) {
                exitCode = 1; break;
            }
        }
    }
    destroy(&t);
    if (fflush(stdout) == EOF) return 2;
    return exitCode;
}
