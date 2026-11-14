#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct { int edge[4]; int terminal; } Node;
static Node pool[32];
static int used=1;
static void insert(const char *s) {
    int at=0;
    while(*s) {
        int k=*s++-'a';
        if(!pool[at].edge[k]) pool[at].edge[k]=used++;
        at=pool[at].edge[k];
    }
    pool[at].terminal++;
}
static int find(const char *s) {
    int at=0;
    while(*s) {
        at=pool[at].edge[*s++-'a'];
        if(!at) return 0;
    }
    return pool[at].terminal;
}
int main(void) {
    insert("a"); insert("ab"); insert("abc"); insert("ad"); insert("b"); insert("ab");
    printf("%d %d %d %d\n",find("ab"),find("ac"),find("abc"),used);
    return 0;
}
