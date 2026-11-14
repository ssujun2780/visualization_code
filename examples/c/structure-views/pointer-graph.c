#include <stdio.h>
typedef struct Vertex { int value; struct Vertex *next, *across; } Vertex;
Vertex vertices[5];
int main(void) {
    for (int i=0;i<5;i++) {
        vertices[i].value=i;
        vertices[i].next=&vertices[(i+1)%5];
        vertices[i].across=&vertices[(i+2)%5];
    }
    Vertex *p=vertices;
    int total=0;
    for (int i=0;i<5;i++) { total+=p->value; p=p->next; }
    printf("%d\n",total);
    return 0;
}
