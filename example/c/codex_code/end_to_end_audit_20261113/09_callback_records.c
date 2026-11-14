#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct { int key,id; } Item;
static int compare(const void *a,const void *b) {
    const Item *x=a,*y=b;
    return x->key!=y->key ? (x->key>y->key)-(x->key<y->key) : (x->id>y->id)-(x->id<y->id);
}
int main(void) {
    Item items[8];
    for(int i=0;i<8;i++) items[i]=(Item){(i*7)%5,i};
    qsort(items,8,sizeof(*items),compare);
    for(int i=0;i<8;i++) printf("%d:%d%c",items[i].key,items[i].id,i==7?'\n':' ');
    return 0;
}
