#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
enum { N=8, INF=1000000 };
static int weight(int u,int v) {
    if(u==v) return 0;
    if(v==u+1 || (u*7+v*3)%5==0) return 1+(u*11+v*7)%9;
    return INF;
}

typedef struct { int vertex,cost; } Entry;
typedef struct { Entry data[128]; int count; } Heap;
static void push(Heap *h,Entry value) {
    int i=h->count++;
    while(i>0) {
        int parent=(i-1)/2;
        if(h->data[parent].cost<=value.cost) break;
        h->data[i]=h->data[parent]; i=parent;
    }
    h->data[i]=value;
}
static Entry pop(Heap *h) {
    Entry answer=h->data[0],tail=h->data[--h->count];
    int at=0;
    while(2*at+1<h->count) {
        int child=2*at+1;
        if(child+1<h->count && h->data[child+1].cost<h->data[child].cost) child++;
        if(tail.cost<=h->data[child].cost) break;
        h->data[at]=h->data[child]; at=child;
    }
    if(h->count) h->data[at]=tail;
    return answer;
}
int main(void) {
    int offsets[N+1],to[N*N],cost[N*N],dist[N],edges=0;
    for(int u=0;u<N;u++) {
        offsets[u]=edges;
        for(int v=0;v<N;v++) {
            int w=weight(u,v);
            if(u!=v && w!=INF) { to[edges]=v; cost[edges]=w; edges++; }
        }
        dist[u]=u?INF:0;
    }
    offsets[N]=edges;
    Heap heap={0}; push(&heap,(Entry){0,0});
    while(heap.count) {
        Entry current=pop(&heap);
        if(current.cost!=dist[current.vertex]) continue;
        for(int e=offsets[current.vertex];e<offsets[current.vertex+1];e++) {
            int v=to[e],candidate=current.cost+cost[e];
            if(candidate<dist[v]) { dist[v]=candidate; push(&heap,(Entry){v,candidate}); }
        }
    }
    for(int i=0;i<N;i++) printf("%d%c",dist[i],i==N-1?'\n':' ');
    return 0;
}
