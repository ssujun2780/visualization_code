#include <stdio.h>

enum { VERTICES = 16, EDGES = 64 };
typedef struct {
    int first[VERTICES];
    int destination[EDGES];
    int next[EDGES];
    int edge_count;
} Graph;
typedef struct {
    int discovery[VERTICES];
    int low[VERTICES];
    int active[VERTICES];
    int component[VERTICES];
    int stack[VERTICES];
    int stack_size;
    int clock;
    int component_count;
} Search;

static void connect(Graph *graph, int from, int to) {
    int edge = graph->edge_count++;
    graph->destination[edge] = to;
    graph->next[edge] = graph->first[from];
    graph->first[from] = edge;
}

static void explore(const Graph *graph, Search *search, int vertex) {
    search->discovery[vertex] = ++search->clock;
    search->low[vertex] = search->discovery[vertex];
    search->stack[search->stack_size++] = vertex;
    search->active[vertex] = 1;

    for (int edge = graph->first[vertex]; edge != -1; edge = graph->next[edge]) {
        int next = graph->destination[edge];
        if (search->discovery[next] == 0) {
            explore(graph, search, next);
            if (search->low[next] < search->low[vertex]) {
                search->low[vertex] = search->low[next];
            }
        } else if (search->active[next] && search->discovery[next] < search->low[vertex]) {
            search->low[vertex] = search->discovery[next];
        }
    }

    if (search->low[vertex] == search->discovery[vertex]) {
        int member;
        do {
            member = search->stack[--search->stack_size];
            search->active[member] = 0;
            search->component[member] = search->component_count;
        } while (member != vertex);
        ++search->component_count;
    }
}

int main(void) {
    Graph graph = {0};
    Search search = {0};
    int n, m;
    if (scanf("%d%d", &n, &m) != 2 || n < 1 || n > VERTICES || m < 0 || m > EDGES) return 1;
    for (int vertex = 0; vertex < n; ++vertex) graph.first[vertex] = -1;
    for (int i = 0; i < m; ++i) {
        int from, to, unused_weight;
        if (scanf("%d%d%d", &from, &to, &unused_weight) != 3
            || from < 0 || from >= n || to < 0 || to >= n) return 1;
        connect(&graph, from, to);
    }
    for (int vertex = 0; vertex < n; ++vertex) {
        if (search.discovery[vertex] == 0) explore(&graph, &search, vertex);
    }
    for (int vertex = 0; vertex < n; ++vertex) {
        int representative = vertex;
        for (int other = 0; other < vertex; ++other) {
            if (search.component[other] == search.component[vertex]) {
                representative = other;
                break;
            }
        }
        printf("%d%c", representative, vertex + 1 == n ? '\n' : ' ');
    }
    return 0;
}
