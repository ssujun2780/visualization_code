#include <stdio.h>
typedef struct Item { int cost; struct Item *next; } Item;
int main(void) {
    Item nodes[3]={{0,0},{10,0},{20,0}};
    int weights[3][3]={{0,4,7},{4,0,2},{7,2,0}};
    nodes[0].next=&nodes[2];
    nodes[2].next=&nodes[1];
    Item *cursor=&nodes[0];
    cursor->next->cost=cursor->cost+weights[0][2];
    cursor=cursor->next;
    cursor->next->cost=cursor->cost+weights[2][1];
    printf("%d %d %d\n",nodes[0].cost,nodes[1].cost,nodes[2].cost);
    return 0;
}
