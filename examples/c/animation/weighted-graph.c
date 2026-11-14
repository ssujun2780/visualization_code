#include <stdio.h>
#include <limits.h>

typedef struct { int from, to, weight; } Edge;
Edge edges[] = {{0,1,10},{0,2,30},{0,3,15},{1,4,20},{3,2,5},
                {2,5,5},{3,5,20},{4,5,5},{5,3,20}};

int main(void) {
    int distance[6], used[6] = {0};
    for (int i=0; i<6; i++) distance[i] = INT_MAX;
    distance[0] = 0;
    for (int step=0; step<6; step++) {
        int u=-1;
        for (int v=0; v<6; v++)
            if (!used[v] && (u<0 || distance[v]<distance[u])) u=v;
        if (u<0 || distance[u]==INT_MAX) break;
        used[u]=1;
        for (int e=0; e<9; e++) {
            int v=edges[e].to;
            if (edges[e].from==u && distance[u]+edges[e].weight<distance[v])
                distance[v]=distance[u]+edges[e].weight;
        }
    }
    for (int i=0; i<6; i++) printf("%d ", distance[i]);
    return 0;
}
