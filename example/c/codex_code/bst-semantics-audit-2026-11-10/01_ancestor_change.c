#include <stdio.h>
typedef struct N { struct N *a; int k; struct N *b; } N;
int walk(N *p) { return p ? 1 + walk(p->a) + walk(p->b) : 0; }
int find(N *p, int k) {
    while (p) {
        if (k == p->k) return 1;
        p = k < p->k ? p->a : p->b;
    }
    return 0;
}
int main(void) {
    N n[5] = {{0,7,0},{0,5,0},{0,99,0},{0,10,0},{0,15,0}};
    n[3].a=n+1; n[3].b=n+4; n[1].b=n;
    N *root=n+3;
    printf("P0 %d\n", walk(root));
    int found=find(root,7)+find(root,15);
    printf("P1 %d\n", walk(root)+found);
    n[0].k=12;
    printf("P2 %d\n", walk(root)+find(root,12));
    n[0].k=7;
    printf("P3 %d\n", walk(root)+find(root,7));
    return 0;
}
