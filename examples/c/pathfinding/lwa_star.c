#include <stdio.h>
#include <stdlib.h>

#define VERTEX_COUNT 8
#define EDGE_COUNT 12
#define BRANCH_COUNT 6
#define OPEN_CAPACITY VERTEX_COUNT
#define INF 10000

/* IDs: 0 = S, 1..6 = alternative waypoints, 7 = goal. */
typedef struct {
    int g, h, closed, parent, x, y;
    int first_edge, incoming_count, outgoing_cost;
} Vertex;

typedef struct {
    int from, to, cost;
    int status; /* -1 = unchecked, 0 = blocked, 1 = verified clear */
    int next;
} Edge;

typedef struct {
    int vertex, parent, edge, g, f, verified;
} Candidate;

typedef struct {
    int xmin, ymin, xmax, ymax;
} Obstacle;

Vertex vertices[VERTEX_COUNT];
Edge edges[EDGE_COUNT];
Obstacle obstacles[BRANCH_COUNT];
Candidate open_heap[OPEN_CAPACITY];
int open_position[VERTEX_COUNT];
int open_size, obstacle_count, indexed_open, batch;
int collision_checks, obstacle_tests, expansions;
int heap_pushes, heap_pops, heap_updates, max_open;

/* The same graph, geometry, heuristic, and input convention in both files.
   These precomputed edge lengths are exact Euclidean distances:
   60^2 + rise^2 = length^2, with all coordinates/lengths scaled by 5. */
static void build_graph(int blocked_mask) {
    const int rise[BRANCH_COUNT] = {0, 11, 25, 45, 80, 144};
    const int length[BRANCH_COUNT] = {60, 61, 65, 75, 100, 156};
    vertices[0].x = 0;
    vertices[0].y = 0;
    vertices[0].h = 600;
    vertices[7].x = 600;
    vertices[7].y = 0;
    vertices[7].h = 0;
    for (int i = 0; i < BRANCH_COUNT; i++) {
        int v = i + 1;
        vertices[v].x = 300;
        vertices[v].y = 5 * rise[i];
        vertices[v].h = 5 * length[i];
        edges[i] = (Edge){0, v, 5 * length[i], -1, -1};
        /* All obstacles have x in [59,61]; these edges have x in [300,600].
           Thus their validity is known before either search begins. */
        edges[BRANCH_COUNT + i] = (Edge){v, 7, 5 * length[i], 1, -1};
        if ((blocked_mask & (1 << i)) != 0) {
            obstacles[obstacle_count++] =
                (Obstacle){59, rise[i] - 1, 61, rise[i] + 1};
        }
    }
    /* Finish every adjacency row before touching OPEN or search state.
       Reverse insertion preserves increasing edge order in each row. */
    for (int u = 0; u < VERTEX_COUNT; u++) {
        vertices[u].first_edge = -1;
        vertices[u].outgoing_cost = 0;
        for (int e = EDGE_COUNT - 1; e >= 0; e--) {
            if (edges[e].from == u) {
                int v = edges[e].to;
                vertices[v].incoming_count++;
                vertices[u].outgoing_cost += edges[e].cost;
                edges[e].next = vertices[u].first_edge;
                vertices[u].first_edge = e;
            }
        }
    }
    printf("GRAPH_READY vertices=%d edges=%d\n", VERTEX_COUNT, EDGE_COUNT);
}

static void initialize_search(void) {
    for (int v = 0; v < VERTEX_COUNT; v++) {
        vertices[v].g = INF;
        vertices[v].parent = -1;
        vertices[v].closed = 0;
        open_position[v] = -1;
    }
    printf("SEARCH_BEGIN\n");
}

/* Positive-length intersection with the rectangle's open interior.
   Merely touching an edge or corner does not count as a collision. */
static int segment_hits_rectangle(int from, int to, const Obstacle *r) {
    double enter = 0.0, leave = 1.0;
    for (int axis = 0; axis < 2; axis++) {
        double a = axis == 0 ? vertices[from].x : vertices[from].y;
        double b = axis == 0 ? vertices[to].x : vertices[to].y;
        double low = axis == 0 ? r->xmin : r->ymin;
        double high = axis == 0 ? r->xmax : r->ymax;
        double delta = b - a;
        if (delta == 0.0) {
            if (a <= low || a >= high) return 0;
        } else {
            double t0 = (low - a) / delta;
            double t1 = (high - a) / delta;
            if (t0 > t1) {
                double temporary = t0;
                t0 = t1;
                t1 = temporary;
            }
            if (t0 > enter) enter = t0;
            if (t1 < leave) leave = t1;
            if (enter >= leave) return 0;
        }
    }
    return 1;
}

static int evaluate_edge(int e) {
    if (edges[e].status != -1) return edges[e].status;
    collision_checks++;
    edges[e].status = 1;
    for (int i = 0; i < obstacle_count; i++) {
        obstacle_tests++;
        if (segment_hits_rectangle(edges[e].from, edges[e].to, &obstacles[i])) {
            edges[e].status = 0;
            break;
        }
    }
    printf("CHECK %d->%d %s\n", edges[e].from, edges[e].to,
           edges[e].status ? "clear" : "blocked");
    return edges[e].status;
}

/* Both algorithms use the same (f, g, vertex, parent) ordering.
   A* maintains one indexed OPEN entry per vertex.
   LWA* permits entries with different incoming edges. */
static int before(int a, int b) {
    if (open_heap[a].f != open_heap[b].f) return open_heap[a].f < open_heap[b].f;
    if (open_heap[a].g != open_heap[b].g) return open_heap[a].g < open_heap[b].g;
    if (open_heap[a].vertex != open_heap[b].vertex)
        return open_heap[a].vertex < open_heap[b].vertex;
    return open_heap[a].parent < open_heap[b].parent;
}

static void swap_candidates(int a, int b) {
    Candidate temporary = open_heap[a];
    open_heap[a] = open_heap[b];
    open_heap[b] = temporary;
    if (indexed_open) {
        open_position[open_heap[a].vertex] = a;
        open_position[open_heap[b].vertex] = b;
    }
}

static void sift_up(int at) {
    while (at > 0) {
        int parent = (at - 1) / 2;
        if (!before(at, parent)) break;
        swap_candidates(at, parent);
        at = parent;
    }
}

static void sift_down(int at) {
    while (2 * at + 1 < open_size) {
        int child = 2 * at + 1;
        if (child + 1 < open_size && before(child + 1, child)) child++;
        if (!before(child, at)) break;
        swap_candidates(at, child);
        at = child;
    }
}

static void offer(Candidate item) {
    int at = indexed_open ? open_position[item.vertex] : -1;
    if (at >= 0) {
        open_heap[at] = item;
        heap_updates++;
    } else {
        if (open_size == OPEN_CAPACITY) {
            fputs("OPEN capacity exceeded\n", stderr);
            exit(2);
        }
        at = open_size++;
        open_heap[at] = item;
        if (indexed_open) open_position[item.vertex] = at;
        heap_pushes++;
        if (open_size > max_open) max_open = open_size;
    }
    if (!batch) sift_up(at);
    printf("OPEN node=%d parent=%d g=%d f=%d verified=%d\n",
           item.vertex, item.parent, item.g, item.f, item.verified);
}

/* If OPEN was empty before expansion, collect successors and heapify once.
   This gives both algorithms the same linear-time initial heap construction. */
static void finish_expansion(void) {
    if (batch)
        for (int at = open_size / 2 - 1; at >= 0; at--) sift_down(at);
    batch = 0;
}

static Candidate take_minimum(void) {
    Candidate item = open_heap[0];
    open_size--;
    if (indexed_open) open_position[item.vertex] = -1;
    if (open_size > 0) {
        open_heap[0] = open_heap[open_size];
        if (indexed_open) open_position[open_heap[0].vertex] = 0;
        sift_down(0);
    }
    heap_pops++;
    printf("POP node=%d parent=%d g=%d f=%d verified=%d\n",
           item.vertex, item.parent, item.g, item.f, item.verified);
    return item;
}

/* LWA*, weight = 1.
   vertices[v].g is the best VERIFIED cost; unchecked g lives in OPEN.
   Different unchecked parents must not overwrite one another. */
static int search(void) {
    vertices[0].g = 0;
    offer((Candidate){0, -1, -1, 0, vertices[0].h, 1});
    while (open_size > 0) {
        Candidate current = take_minimum();
        int u = current.vertex;
        if (vertices[u].closed) continue;
        if (!current.verified) {
            if (!evaluate_edge(current.edge)) continue;
            if (current.g >= vertices[u].g) continue;
            current.verified = 1;
            vertices[u].g = current.g;
            vertices[u].parent = current.parent;
            offer(current);
            continue;
        }
        if (current.g != vertices[u].g) continue;
        /* Never accept an unchecked goal. */
        if (u == 7) return 1;
        vertices[u].closed = 1;
        expansions++;
        printf("EXPAND node=%d\n", u);
        batch = open_size == 0;
        for (int e = vertices[u].first_edge; e != -1; e = edges[e].next) {
            if (edges[e].status == 0) continue;
            int v = edges[e].to;
            int new_g = current.g + edges[e].cost;
            if (vertices[v].closed || new_g >= vertices[v].g) continue;
            int verified = edges[e].status == 1;
            if (verified) {
                vertices[v].g = new_g;
                vertices[v].parent = u;
            }
            offer((Candidate){v, u, e, new_g, new_g + vertices[v].h, verified});
        }
        finish_expansion();
    }
    return 0;
}

static void report(int found) {
    if (found) {
        int path[VERTEX_COUNT], count = 0, v = 7;
        while (v != -1 && count < VERTEX_COUNT) {
            path[count++] = v;
            v = vertices[v].parent;
        }
        printf("PATH");
        for (int i = count - 1; i >= 0; i--) printf(" %d", path[i]);
        printf("\nCOST %d\n", vertices[7].g);
    } else {
        printf("NO_PATH\n");
    }
    printf("CHECKS %d\nOBSTACLE_TESTS %d\nEXPANSIONS %d\n",
           collision_checks, obstacle_tests, expansions);
    printf("HEAP_PUSHES %d\nHEAP_POPS %d\nHEAP_UPDATES %d\nMAX_OPEN %d\n",
           heap_pushes, heap_pops, heap_updates, max_open);
}

int main(void) {
    int blocked_mask = 3;
    int input = scanf("%d", &blocked_mask);
    if (input == 0 || blocked_mask < 0 || blocked_mask >= (1 << BRANCH_COUNT)) {
        fputs("Input must be a blocked-edge mask from 0 to 63.\n", stderr);
        return 1;
    }
    indexed_open = 0;
    build_graph(blocked_mask);
    printf("ALGORITHM LWA*\nMASK %d\n", blocked_mask);
    initialize_search();
    report(search());
    return 0;
}
