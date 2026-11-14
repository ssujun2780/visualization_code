"""Freeze source-derived expectations before invoking either native C or the model."""
from pathlib import Path
import json, hashlib, textwrap

HERE = Path(__file__).resolve().parent
HEAD = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <stdint.h>\n#include <assert.h>\n'
cases = []
def add(name, body, variants, style, intent, prediction):
    source = HEAD + textwrap.dedent(body).strip() + '\n'
    (HERE / (name + '.c')).write_bytes(source.encode('utf-8'))
    for label, stdin, expected in variants:
        cases.append(dict(id=name+'-'+label, file=name+'.c', stdin=stdin, expected=expected,
                          style=style, intent=intent, processPrediction=prediction,
                          sourceSha256=hashlib.sha256(source.encode()).hexdigest()))
def fixed(out, **kw): return [('fixed', '', dict(stdout=out, **kw))]
def series(n): return [(i * 13 + 7) % 19 - 9 for i in range(n)]
def sorted_output(n): return ' '.join(map(str, sorted(series(n))))+'\n'

add('01_scalars', r'''
int main(void) {
    int a=13, b=-4;
    int value=(a+b)*3-a/2; // @audit expression
    unsigned char byte=(unsigned char)260;
    unsigned int wrap=(unsigned int)-1;
    int seen=0;
    int ok=(value>10 && ++seen==1) || ++seen==4;
    printf("%d %u %u %d %d\n", value, (unsigned)byte, wrap, seen, ok);
    return 0;
}
''', fixed('21 4 4294967295 1 1\n', writes={'expression':['21']}),
    'short conventional', 'scalar arithmetic, promotions and short circuit',
    'One source CALC for (a+b)*3-a/2, WRITE 21; seen increments once; skipped OR operand is not executed.')

add('02_macro_checks', r'''
#define SWAP(a,b) do { int saved=(a); (a)=(b); (b)=saved; } while(0)
#define MIX(a,b) (((a)+1)*((b)-2))
static int check(int x) { assert(x>0); return x; }
int main(void) {
    int a=3,b=9,hits=0;
    SWAP(a,b);
    int value=MIX(a,b); // @audit macro
    assert(++hits);
    assert(value || ++hits);
    printf("%d %d %d %d\n",a,b,check(value),hits);
    return 0;
}
''', fixed('9 3 10 1\n', writes={'macro':['10']}, asserts=3),
    'short macros', 'macro scopes, assertions, call/return',
    'SWAP creates a local temporary at expansion; MIX yields 10 once; three passed assert.check events; hits remains 1.')

add('03_recursive_rework', r'''
static int fib(int n) {
    if(n<2) return n;
    int left=fib(n-1);
    int right=fib(n-2);
    return left+right;
}
int main(void) {
    int n=0;
    if(scanf("%d",&n)!=1 || n<0 || n>12) return 1;
    int answer=fib(n); // @audit result
    printf("%d\n",answer);
    return 0;
}
''', [(str(n),str(n)+'\n',dict(stdout=str(v)+'\n',writes={'result':[str(v)]},calls={'fib':c}))
      for n,v,c in [(6,8,25),(9,34,109)]],
    'intentionally inefficient recursion', 'many independent frame lifetimes and returned values',
    'Each recursive call gets its own frame; 25/109 fib calls; destination receives return before corresponding frame is removed.')

add('04_strings_aliases', r'''
typedef struct { int value; char *text; } Record;
int main(void) {
    char a[32]="ABCDE", b[32]={0};
    char *p=a+1;
    memmove(p+1,p,4);
    a[6]='\0';
    memcpy(b,a,7);
    Record first={7,a}, second=first;
    second.text[0]='Z';
    snprintf(b+7,sizeof(b)-7,"%d:%s",second.value,b);
    puts(a);
    fwrite(b,1,6,stdout);
    putchar('\n');
    puts(b+7);
    return 0;
}
''', fixed('ZBBCDE\nABBCDE\n7:ABBCDE\n'),
    'mixed library and aliases', 'overlap-safe copy, shallow struct copy, distinct output APIs',
    'memmove and memcpy update ranges; struct copy shares the text pointer, not the text array; all stdout APIs preserve bytes and order.')

vector = r'''
int main(void) {
    int n=0, length=0, capacity=0, *data=NULL;
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    for(int i=0;i<n;i++) {
        if(length==capacity) {
            int next=GROW;
            int *grown=realloc(data,(size_t)next*sizeof(*data));
            if(!grown) { free(data); return 1; }
            data=grown;
            capacity=next;
        }
        data[length++]=i*i;
    }
    int sum=0;
    for(int i=0;i<length;i++) {
        sum+=data[i]; // @audit sum
    }
    printf("%d %d\n",length,sum);
    free(data);
    return 0;
}
'''
for name,grow,style in [('05_vector_one','capacity+1','novice, realloc every append'),
                        ('06_vector_double','capacity?capacity*2:1','geometric capacity')]:
    add(name,vector.replace('GROW',grow),
        [(str(n),str(n)+'\n',dict(stdout=f'{n} {sum(i*i for i in range(n))}\n',
          writes={'sum':[str(sum(j*j for j in range(i+1))) for i in range(n)]}))
         for n in [8,16,32]],style,'growing heap array with capacity and length',
        'Every realloc retains the existing prefix; old allocation lifetime ends only according to observed outcome; cumulative sum WRITE for every element.')

sort_main = r'''
int main(void) {
    int n=0,a[64];
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    for(int i=0;i<n;i++) a[i]=(i*13+7)%19-9;
    SORT
    for(int i=0;i<n;i++) printf("%d%c",a[i],i+1==n?'\n':' ');
    return 0;
}
'''
add('07_bubble_novice',sort_main.replace('SORT',r'''
    for(int i=0;i<n;i++)
        for(int j=0;j+1<n;j++)
            if(a[j]>a[j+1]) {
                int temp=a[j]; a[j]=a[j+1]; a[j+1]=temp;
            }
'''),[(str(n),str(n)+'\n',dict(stdout=sorted_output(n))) for n in [8,16,32]],
    'novice repeated full scans','in-place comparison sort',
    'Repeated comparisons and swaps must all remain recorded; no inferred sorting shortcut replaces actual work.')

add('08_merge_sort',r'''
static void sort(int *a,int *tmp,int lo,int hi) {
    if(hi-lo<2) return;
    int mid=lo+(hi-lo)/2;
    sort(a,tmp,lo,mid); sort(a,tmp,mid,hi);
    int i=lo,j=mid,k=lo;
    while(i<mid && j<hi) tmp[k++]=a[i]<=a[j]?a[i++]:a[j++];
    while(i<mid) tmp[k++]=a[i++];
    while(j<hi) tmp[k++]=a[j++];
    for(k=lo;k<hi;k++) a[k]=tmp[k];
}
'''+sort_main.replace('SORT','int tmp[64]; sort(a,tmp,0,n);'),
    [(str(n),str(n)+'\n',dict(stdout=sorted_output(n))) for n in [8,16,32]],
    'compact conventional recursive algorithm','two related arrays and ternary side effects',
    'Only selected ternary operand advances i or j; both temporary and original array stores remain visible, with distinct identities.')

add('09_callback_records',r'''
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
''',fixed(' '.join(f'{k}:{i}' for k,i in sorted(((i*7)%5,i) for i in range(8)))+'\n'),
    'expert compact callback','library callback, aggregate copy and composite comparison',
    'qsort callback frames must bind real arguments and all sorted writes must reach the same array, without exposing fabricated library internals.')

add('10_list_slow',r'''
typedef struct Cell { int value; struct Cell *next; } Cell;
int main(void) {
    int n=0;
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    Cell *head=NULL;
    for(int i=0;i<n;i++) {
        Cell *fresh=calloc(1,sizeof(*fresh));
        if(!fresh) return 1;
        fresh->value=i+1;
        if(!head) head=fresh;
        else { Cell *p=head; while(p->next) p=p->next; p->next=fresh; }
    }
    Cell *back=NULL,*p=head;
    while(p) { Cell *next=p->next; p->next=back; back=p; p=next; }
    head=back;
    int sum=0;
    for(p=head;p;p=p->next) {
        sum+=p->value; // @audit sum
    }
    printf("%d\n",sum);
    while(head) { Cell *next=head->next; free(head); head=next; }
    return 0;
}
''',[(str(n),str(n)+'\n',dict(stdout=f'{n*(n+1)//2}\n',writes={'sum':[str(sum(range(n-i,n+1))) for i in range(n)]})) for n in [8,16,32]],
    'novice quadratic append','pointer list with reversal and individual frees',
    'NULL-terminated chain grows, reverses direction, then disappears one allocation at a time. Historical links must not show future reversal.')

add('11_index_chimera',r'''
int main(void) {
    int value[12]={0}, next[12], head=-1, free_head=0, unused_metric[12]={0};
    for(int i=0;i<12;i++) next[i]=i==11?-1:i+1;
    for(int i=0;i<7;i++) {
        int slot=free_head; free_head=next[slot];
        value[slot]=i*3; unused_metric[slot]=i%2;
        next[slot]=head; head=slot;
    }
    int sum=0;
    for(int p=head;p!=-1;p=next[p]) {
        sum+=value[p]; // @audit sum
    }
    printf("%d %d\n",sum,unused_metric[3]);
    return 0;
}
''',fixed('63 1\n',writes={'sum':['18','33','45','54','60','63','63']}),
    'beginner hybrid with irrelevant fields','split-array active list and separate free chain',
    'Active chain is 6,5,4,3,2,1,0 ending at -1; unused slots 7..11 belong to free chain, not active logical members.')

add('12_grid_ring_bfs',r'''
int main(void) {
    int dist[20], queue[20], read=0, write=0, size=0;
    for(int i=0;i<20;i++) dist[i]=-1;
    dist[0]=0; queue[write++]=0; size++;
    const int dr[4]={-1,1,0,0}, dc[4]={0,0,-1,1};
    while(size) {
        int u=queue[read]; read=(read+1)%20; size--;
        for(int d=0;d<4;d++) {
            int r=u/5+dr[d],c=u%5+dc[d];
            if(r<0 || r>=4 || c<0 || c>=5) continue;
            int v=r*5+c;
            if(v==7 || v==12 || dist[v]!=-1) continue;
            dist[v]=dist[u]+1; queue[write]=v; write=(write+1)%20; size++;
        }
    }
    for(int i=0;i<20;i++) printf("%d%c",dist[i],i==19?'\n':' ');
    return 0;
}
''',fixed('0 1 2 3 4 1 2 -1 4 5 2 3 -1 5 6 3 4 5 6 7\n'),
    'ordinary flattened grid','grid geometry plus ring queue and visited state',
    'Unreached cells stay -1, obstacles 7 and 12 stay untouched after initialization; queue is logical FIFO, not all capacity at once.')

add('13_bst_parent',r'''
typedef struct Node { int key; struct Node *left,*right,*parent; } Node;
static Node *insert(Node *root,Node *fresh) {
    if(!root) return fresh;
    Node *p=root;
    for(;;) {
        Node **slot=fresh->key<p->key?&p->left:&p->right;
        if(!*slot) { *slot=fresh; fresh->parent=p; return root; }
        p=*slot;
    }
}
static void print(Node *root) {
    if(!root) return;
    print(root->left); printf("%d ",root->key); print(root->right);
}
int main(void) {
    Node pool[9]={0}, *root=NULL;
    int keys[9]={8,3,12,1,5,10,15,4,6};
    for(int i=0;i<9;i++) { pool[i].key=keys[i]; root=insert(root,&pool[i]); }
    print(root); puts("");
    return 0;
}
''',fixed('1 3 4 5 6 8 10 12 15 \n'),
    'compact parent-linked tree','tree child relationships plus reverse parent edges',
    'Nine tree nodes, eight child edges; parent backlinks are a distinct role, not a structural cycle in child-tree interpretation.')

add('14_trie_sparse',r'''
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
''',fixed('2 0 1 6\n'),
    'compact global pool','sparse indexed trie with shared zero termination',
    'Six used logical nodes including root; zero child edges are absent links, not a shared real child; duplicate word increments terminal only.')

add('15_lcs_scattered',r'''
int main(void) {
    const char *a="BANANA",*b="ATANA";
    int n=(int)strlen(a),m=(int)strlen(b);
    int **dp=calloc((size_t)n+1,sizeof(*dp));
    if(!dp) return 1;
    for(int i=0;i<=n;i++) { dp[i]=calloc((size_t)m+1,sizeof(**dp)); if(!dp[i]) return 1; }
    for(int i=1;i<=n;i++) {
        for(int j=1;j<=m;j++) {
            if(a[i-1]==b[j-1]) dp[i][j]=dp[i-1][j-1]+1;
            else dp[i][j]=dp[i-1][j]>dp[i][j-1]?dp[i-1][j]:dp[i][j-1];
        }
    }
    printf("%d\n",dp[n][m]);
    for(int i=0;i<=n;i++) free(dp[i]);
    free(dp);
    return 0;
}
''',fixed('4\n'),'verbose dynamic rows','pointer-to-pointer grid and nested ternaries',
    'Pointer table and seven separately allocated rows stay distinct storage; grid view must preserve row and column identities and all frees.')

add('16_bits_goto',r'''
int main(void) {
    uint64_t rows[8]={0};
    int i=0;
fill:
    if(i>=8) goto closure;
    rows[i]=(UINT64_C(1)<<i)|(UINT64_C(1)<<((i+1)%8));
    i++; goto fill;
closure:
    for(int k=0;k<8;k++)
        for(int j=0;j<8;j++)
            if(rows[j]&(UINT64_C(1)<<k)) rows[j]|=rows[k];
    for(i=0;i<8;i++) printf("%llu%c",(unsigned long long)rows[i],i==7?'\n':' ');
    return 0;
}
''',fixed('255 255 255 255 255 255 255 255\n'),
    'spaghetti initialization, compact bitset algorithm','goto, fixed-width shifts, bitset reachability',
    'Actual goto and all bitset read-modify-writes are retained; eight masks reach 255 without inventing eight separate allocated nodes per bit.')

add('17_aggregate_return',r'''
typedef struct { int sum; double mean; } Stats;
static Stats summarize(const int *a,int n) {
    int sum=0;
    for(int i=0;i<n;i++) sum+=a[i];
    return (Stats){sum,(double)sum/n};
}
int main(void) {
    int n=4;
    int grid[n][n];
    for(int i=0;i<n;i++) for(int j=0;j<n;j++) grid[i][j]=i+j;
    Stats (*fn)(const int *,int)=summarize;
    Stats result=fn(grid[2],n);
    printf("%d %.1f %d\n",result.sum,result.mean,grid[3][1]);
    return 0;
}
''',fixed('14 3.5 4\n'),
    'compact typed abstraction','VLA, row pointer, indirect call, returned compound literal',
    'Runtime 4x4 stack storage, row offset to summarize, one Stats aggregate returned into result; no address inferred from value similarity.')

graph_body = r'''
enum { N=8, INF=1000000 };
static int weight(int u,int v) {
    if(u==v) return 0;
    if(v==u+1 || (u*7+v*3)%5==0) return 1+(u*11+v*7)%9;
    return INF;
}
'''
dist=[10**6]*8;dist[0]=0
edges=[(u,v,1+(u*11+v*7)%9) for u in range(8) for v in range(8)
       if u!=v and (v==u+1 or (u*7+v*3)%5==0)]
for _ in range(7):
    for u,v,w in edges: dist[v]=min(dist[v],dist[u]+w)
graph_output=' '.join(map(str,dist))+'\n'
add('18_dijkstra_matrix',graph_body+r'''
int main(void) {
    int graph[N][N],dist[N],used[N]={0};
    for(int i=0;i<N;i++) {
        dist[i]=i?INF:0;
        for(int j=0;j<N;j++) graph[i][j]=weight(i,j);
    }
    for(int step=0;step<N;step++) {
        int u=-1;
        for(int i=0;i<N;i++) if(!used[i] && (u==-1 || dist[i]<dist[u])) u=i;
        if(u==-1 || dist[u]==INF) break;
        used[u]=1;
        for(int v=0;v<N;v++) {
            if(graph[u][v]!=INF && dist[v]>dist[u]+graph[u][v]) dist[v]=dist[u]+graph[u][v];
        }
    }
    for(int i=0;i<N;i++) printf("%d%c",dist[i],i==N-1?'\n':' ');
    return 0;
}
''',fixed(graph_output),'ordinary matrix implementation','weighted graph, tentative distance and settled flags',
    'Matrix stores edge weights; dist and used are auxiliary arrays, not graph topology. Relaxations agree with independent Bellman-Ford expected result.')

add('19_dijkstra_csr_heap',graph_body+r'''
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
''',fixed(graph_output),'longer expert composition','CSR graph with separate binary heap and stale-entry filtering',
    'CSR offset/to/cost arrays represent graph, Heap.data is distinct priority worklist; pop aggregate is passed correctly; output agrees with matrix version and Bellman-Ford oracle.')

lru_code = r'''
enum { BUCKETS=7 };
typedef struct Entry Entry;
struct Entry {
    int key;
    int value;
    Entry *older;
    Entry *newer;
    Entry *collision;
};
typedef struct {
    Entry *buckets[BUCKETS];
    Entry *newest;
    Entry *oldest;
    int count;
    int capacity;
    int hits;
    int misses;
} Cache;

static unsigned bucket(int key) {
    return (unsigned)key % BUCKETS;
}

static Entry *lookup(Cache *cache,int key) {
    Entry *p=cache->buckets[bucket(key)];
    while(p) {
        if(p->key==key) {
            return p;
        }
        p=p->collision;
    }
    return NULL;
}

static void unlink_order(Cache *cache,Entry *entry) {
    if(entry->newer) {
        entry->newer->older=entry->older;
    } else {
        cache->newest=entry->older;
    }
    if(entry->older) {
        entry->older->newer=entry->newer;
    } else {
        cache->oldest=entry->newer;
    }
    entry->older=NULL;
    entry->newer=NULL;
}

static void prepend_order(Cache *cache,Entry *entry) {
    entry->older=cache->newest;
    entry->newer=NULL;
    if(cache->newest) {
        cache->newest->newer=entry;
    } else {
        cache->oldest=entry;
    }
    cache->newest=entry;
}

static void erase(Cache *cache,Entry *entry) {
    Entry **link=&cache->buckets[bucket(entry->key)];
    while(*link!=entry) {
        link=&(*link)->collision;
    }
    *link=entry->collision;
    unlink_order(cache,entry);
    cache->count--;
    free(entry);
}

static void validate(const Cache *cache) {
    int count=0;
    const Entry *newer=NULL;
    for(const Entry *p=cache->newest;p;p=p->older) {
        assert(p->newer==newer);
        newer=p;
        count++;
    }
    assert(newer==cache->oldest);
    assert(count==cache->count);
    assert(count<=cache->capacity);
    count=0;
    for(int i=0;i<BUCKETS;i++) {
        for(const Entry *p=cache->buckets[i];p;p=p->collision) {
            assert(bucket(p->key)==(unsigned)i);
            count++;
        }
    }
    assert(count==cache->count);
}

static int fetch(Cache *cache,int key,int *result) {
    Entry *entry=lookup(cache,key);
    if(entry) {
        cache->hits++;
        if(entry!=cache->newest) {
            unlink_order(cache,entry);
            prepend_order(cache,entry);
        }
        *result=entry->value;
        return 1;
    }
    cache->misses++;
    entry=calloc(1,sizeof(*entry));
    if(!entry) {
        return 0;
    }
    entry->key=key;
    entry->value=key*key+7;
    if(cache->count==cache->capacity) {
        erase(cache,cache->oldest);
    }
    unsigned at=bucket(key);
    entry->collision=cache->buckets[at];
    cache->buckets[at]=entry;
    prepend_order(cache,entry);
    cache->count++;
    *result=entry->value;
    return 1;
}

static void clear(Cache *cache) {
    while(cache->oldest) {
        erase(cache,cache->oldest);
    }
}

static void report(const Cache *cache,int checksum) {
    printf("%d %d %d\n",cache->hits,cache->misses,checksum);
    for(const Entry *p=cache->newest;p;p=p->older) {
        printf("%d%c",p->key,p->older?' ':'\n');
    }
}

int main(void) {
    int capacity=0;
    if(scanf("%d",&capacity)!=1 || capacity<1 || capacity>8) {
        return 1;
    }
    Cache cache={0};
    cache.capacity=capacity;
    const int requests[]={1,2,3,1,4,2,5,1,5,3,6,2,1,7,2,3,4,1};
    int checksum=0;
    for(size_t i=0;i<sizeof(requests)/sizeof(*requests);i++) {
        int value=0;
        if(!fetch(&cache,requests[i],&value)) {
            clear(&cache);
            return 1;
        }
        checksum+=value; // @audit checksum
        validate(&cache);
    }
    report(&cache,checksum);
    clear(&cache);
    validate(&cache);
    return 0;
}
'''
requests=[1,2,3,1,4,2,5,1,5,3,6,2,1,7,2,3,4,1]
lru_variants=[]
for capacity in [3,5]:
    order=[]; hits=0; checksum=0; writes=[]
    for k in requests:
        if k in order:
            hits+=1
            order.remove(k)
        else:
            if len(order)==capacity: order.pop()
        order.insert(0,k)
        checksum+=k*k+7
        writes.append(str(checksum))
    lru_variants.append((str(capacity),str(capacity)+'\n',
                        dict(stdout=f'{hits} {len(requests)-hits} {checksum}\n'+' '.join(map(str,order))+'\n',
                             writes={'checksum':writes})))
add('20_lru_composed',lru_code,lru_variants,'long modular implementation with checked invariants',
    'hash collision chains and doubly linked recency order share individually allocated entries',
    'One Entry belongs to two independent relation families. Hits move nodes without allocation; misses evict only when full; validation assertions and final destruction must replay. Checksum values and newest-first membership/order are predicted independently.')

for name,body in [('21_named_return','Pair temporary={x,x+4}; return temporary;'),
                  ('22_literal_return','return (Pair){x,x+4};')]:
    add(name,'typedef struct { int first,second; } Pair;\n'
        'static Pair make(int x) { '+body+' }\n'
        'int main(void) { Pair answer=make(7); printf("%d %d\\n",answer.first,answer.second); return 0; }',
        fixed('7 11\n'),'minimal independent return-form contrast',
        'same C aggregate value and output via named local versus compound literal',
        'Both return forms are valid C and should be playable; compiler sret storage sharing must not create independent memory or erase the source lifetime.')

(HERE/'cases.json').write_text(json.dumps(dict(version=1,expectationsFrozenBeforeExecution=True,cases=cases),
                                         ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(set(c["file"] for c in cases))} sources, {len(cases)} predefined executions')
