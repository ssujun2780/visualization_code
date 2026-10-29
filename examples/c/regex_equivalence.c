/*
 * Regular-language equivalence, ISO C11, standard library only.
 *
 * Build: gcc -std=c11 -O2 -Wall -Wextra -Wpedantic regex_equivalence.c -o regex_equivalence
 * Usage: regex_equivalence [--stats] < input.txt
 * Input: exactly two regex lines (an empty line means epsilon).
 *
 * Syntax (byte-oriented, case-sensitive):
 *   ab        concatenation
 *   a|b       alternation
 *   a* a+ a?  zero-or-more, one-or-more, optional
 *   (...)     grouping; () is epsilon
 *   .         ANY byte, including NUL and newline
 *   [a-z]     character class; [^a-z] is its complement
 *   []        empty language; [^] matches any one byte
 *   \n \r \t \a \b \f \v \0 \xHH   escaped bytes
 *   \ followed by any other byte makes that byte literal
 * Spaces are literal. ^ $ { } have no special meaning outside classes.
 * Empty alternatives are allowed: a| means a or epsilon.
 * Matching always covers the ENTIRE string. Unicode is treated as UTF-8 bytes.
 *
 * Algorithm:
 *   recursive-descent parser -> AST -> Thompson epsilon-NFA
 *   -> lazy subset construction -> BFS of the product DFA.
 * A reachable product state with different acceptance proves inequivalence.
 * BFS reconstructs a shortest counterexample (ties: byte order).
 * DFA minimization is unnecessary for equivalence testing.
 *
 * Memory/time may grow exponentially. Resource limits produce ERROR, never
 * a guessed equivalence result. Exit status: 0 = comparison completed,
 * 2 = syntax, I/O, allocation, or resource error. --stats writes to stderr.
 *
 * C features: struct/union, pointer arrays, pointer-to-pointer patch lists,
 * function-pointer dispatch, void* containers, flexible array members,
 * designated initializers, compound literals, variadic errors,
 * max_align_t, _Alignof, and _Static_assert.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <inttypes.h>
#include <stddef.h>
#include <limits.h>
#include <ctype.h>
#include <errno.h>
#include <stdarg.h>
#include <assert.h>
#include <time.h>

_Static_assert(CHAR_BIT == 8, "This implementation requires 8-bit bytes.");
_Static_assert(sizeof(uint64_t) * CHAR_BIT == 64, "64-bit integers required.");

#ifndef RX_MAX_PATTERN
#define RX_MAX_PATTERN 16384u
#endif
#ifndef RX_MAX_NFA
#define RX_MAX_NFA 8192u
#endif
#ifndef RX_MAX_DFA
#define RX_MAX_DFA 100000u
#endif
#ifndef RX_MAX_PRODUCT
#define RX_MAX_PRODUCT 500000u
#endif
#ifndef RX_MAX_MEMORY
#define RX_MAX_MEMORY (256u * 1024u * 1024u)
#endif
#define RX_MAX_DEPTH 256u
#define NO_INDEX SIZE_MAX

typedef struct ArenaBlock ArenaBlock;
typedef union {
    long double real;
    void *pointer;
    uint64_t integer;
} ArenaStorage;

struct ArenaBlock {
    ArenaBlock *next;
    ArenaStorage payload[];
};

typedef struct {
    ArenaBlock *blocks;
    size_t allocated;
    uint64_t evaluated_transitions;
    bool stats;
} Context;

static void arena_destroy(Context *ctx);

static _Noreturn void fail(Context *ctx, const char *format, ...) {
    fputs("ERROR: ", stderr);
    va_list args;
    va_start(args, format);
    vfprintf(stderr, format, args);
    va_end(args);
    fputc('\n', stderr);
    arena_destroy(ctx);
    free(ctx);
    exit(2);
}

static size_t checked_add(Context *ctx, size_t a, size_t b) {
    if (b > SIZE_MAX - a) fail(ctx, "size overflow");
    return a + b;
}

static size_t checked_mul(Context *ctx, size_t a, size_t b) {
    if (a && b > SIZE_MAX / a) fail(ctx, "size overflow");
    return a * b;
}

/* Every allocation is tracked, including partially built parser data. */
static void *arena_alloc(Context *ctx, size_t size) {
    size_t total = checked_add(ctx, offsetof(ArenaBlock, payload), size);
    if (total < sizeof(ArenaBlock)) total = sizeof(ArenaBlock);
    size_t used = checked_add(ctx, ctx->allocated, total);
    if (used > (size_t)RX_MAX_MEMORY) fail(ctx, "memory limit exceeded");
    ArenaBlock *block = malloc(total);
    if (!block) fail(ctx, "out of memory");
    block->next = ctx->blocks;
    ctx->blocks = block;
    ctx->allocated = used;
    assert(offsetof(ArenaBlock, payload) % _Alignof(ArenaStorage) == 0);
    memset(block->payload, 0, size);
    return block->payload;
}

static void *arena_array(Context *ctx, size_t count, size_t size) {
    return arena_alloc(ctx, checked_mul(ctx, count, size));
}

static void arena_destroy(Context *ctx) {
    ArenaBlock *block = ctx->blocks;
    while (block) {
        ArenaBlock *next = block->next;
        free(block);
        block = next;
    }
}

typedef struct {
    void *data;
    size_t length, capacity, item_size;
} Vector;

/* Old backing arrays remain in the arena until the comparison ends. */
static void vector_push(Context *ctx, Vector *v, const void *item) {
    if (v->length == v->capacity) {
        size_t capacity = v->capacity ? checked_mul(ctx, v->capacity, 2) : 8;
        void *data = arena_array(ctx, capacity, v->item_size);
        if (v->length) memcpy(data, v->data, v->length * v->item_size);
        v->data = data;
        v->capacity = capacity;
    }
    memcpy((unsigned char *)v->data + v->length * v->item_size,
           item, v->item_size);
    ++v->length;
}

static void vector_pop(Vector *v, void *item) {
    assert(v->length);
    --v->length;
    memcpy(item, (unsigned char *)v->data + v->length * v->item_size,
           v->item_size);
}

typedef struct { uint64_t words[4]; } CharSet;

static void charset_add(CharSet *set, unsigned byte) {
    assert(byte < 256);
    set->words[byte / 64] |= UINT64_C(1) << (byte % 64);
}

static bool charset_has(const CharSet *set, unsigned byte) {
    return (set->words[byte / 64] & (UINT64_C(1) << (byte % 64))) != 0;
}

static void charset_invert(CharSet *set) {
    for (size_t i = 0; i < 4; ++i) set->words[i] = ~set->words[i];
}

typedef enum {
    AST_EPSILON, AST_SET, AST_CONCAT, AST_ALT,
    AST_STAR, AST_PLUS, AST_OPTIONAL, AST_KIND_COUNT
} AstKind;

typedef struct Ast Ast;
struct Ast {
    AstKind kind;
    union {
        CharSet set;
        struct { Ast *left, *right; } pair;
        Ast *child;
    } as;
};

typedef struct {
    Context *ctx;
    const unsigned char *text;
    size_t length, position, depth;
    unsigned input_number;
} Parser;

static _Noreturn void parse_error(Parser *p, const char *message) {
    fail(p->ctx, "regex %u, byte %zu: %s",
         p->input_number, p->position + 1, message);
}

static Ast *ast_new(Context *ctx, AstKind kind) {
    Ast *node = arena_alloc(ctx, sizeof *node);
    node->kind = kind;
    return node;
}

static Ast *ast_pair(Context *ctx, AstKind kind, Ast *left, Ast *right) {
    Ast *node = ast_new(ctx, kind);
    node->as.pair.left = left;
    node->as.pair.right = right;
    return node;
}

static unsigned hex_digit(unsigned char c) {
    if (isdigit(c)) return (unsigned)(c - '0');
    return (unsigned)(tolower(c) - 'a' + 10);
}

/* Called after consuming the backslash. */
static unsigned escaped_byte(Parser *p) {
    if (p->position == p->length) parse_error(p, "unfinished escape");
    unsigned char c = p->text[p->position++];
    switch (c) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'a': return '\a';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return 0;
        case 'x': {
            if (p->length - p->position < 2 ||
                !isxdigit(p->text[p->position]) ||
                !isxdigit(p->text[p->position + 1])) {
                parse_error(p, "\\x requires exactly two hexadecimal digits");
            }
            unsigned high = hex_digit(p->text[p->position++]);
            unsigned low = hex_digit(p->text[p->position++]);
            return high * 16 + low;
        }
        default: return c;
    }
}

static unsigned class_byte(Parser *p) {
    if (p->position == p->length) parse_error(p, "unclosed character class");
    unsigned char c = p->text[p->position++];
    return c == '\\' ? escaped_byte(p) : c;
}

static CharSet parse_class(Parser *p) {
    CharSet set = {{0}};
    bool negate = p->position < p->length && p->text[p->position] == '^';
    if (negate) ++p->position;
    while (p->position < p->length && p->text[p->position] != ']') {
        unsigned first = class_byte(p);
        if (p->position + 1 < p->length &&
            p->text[p->position] == '-' && p->text[p->position + 1] != ']') {
            ++p->position;
            unsigned last = class_byte(p);
            if (first > last) parse_error(p, "descending character range");
            for (unsigned byte = first; byte <= last; ++byte) charset_add(&set, byte);
        } else {
            charset_add(&set, first);
        }
    }
    if (p->position == p->length) parse_error(p, "unclosed character class");
    ++p->position;
    if (negate) charset_invert(&set);
    return set;
}

static Ast *parse_alternation(Parser *p);

static Ast *parse_atom(Parser *p) {
    assert(p->position < p->length);
    unsigned char c = p->text[p->position++];
    if (c == '(') {
        if (++p->depth > RX_MAX_DEPTH) parse_error(p, "parenthesis nesting limit exceeded");
        Ast *inside = parse_alternation(p);
        if (p->position == p->length || p->text[p->position] != ')') {
            parse_error(p, "expected ')'");
        }
        ++p->position;
        --p->depth;
        return inside;
    }
    if (c == '*' || c == '+' || c == '?') {
        parse_error(p, "repetition operator has no operand");
    }
    Ast *node = ast_new(p->ctx, AST_SET);
    if (c == '[') {
        node->as.set = parse_class(p);
    } else if (c == '.') {
        charset_invert(&node->as.set);
    } else {
        charset_add(&node->as.set, c == '\\' ? escaped_byte(p) : c);
    }
    return node;
}

static Ast *parse_repetition(Parser *p) {
    Ast *node = parse_atom(p);
    while (p->position < p->length) {
        AstKind kind;
        switch (p->text[p->position]) {
            case '*': kind = AST_STAR; break;
            case '+': kind = AST_PLUS; break;
            case '?': kind = AST_OPTIONAL; break;
            default: return node;
        }
        ++p->position;
        Ast *parent = ast_new(p->ctx, kind);
        parent->as.child = node;
        node = parent;
    }
    return node;
}

static Ast *parse_concatenation(Parser *p) {
    Ast *node = NULL;
    while (p->position < p->length && p->text[p->position] != '|' &&
           p->text[p->position] != ')') {
        Ast *next = parse_repetition(p);
        node = node ? ast_pair(p->ctx, AST_CONCAT, node, next) : next;
    }
    return node ? node : ast_new(p->ctx, AST_EPSILON);
}

static Ast *parse_alternation(Parser *p) {
    Ast *node = parse_concatenation(p);
    while (p->position < p->length && p->text[p->position] == '|') {
        ++p->position;
        node = ast_pair(p->ctx, AST_ALT, node, parse_concatenation(p));
    }
    return node;
}

static Ast *parse_regex(Context *ctx, const unsigned char *text,
                      size_t length, unsigned input_number) {
    Parser parser = {
        .ctx = ctx, .text = text, .length = length, .input_number = input_number
    };
    Ast *root = parse_alternation(&parser);
    if (parser.position != parser.length) parse_error(&parser, "unexpected ')'");
    return root;
}

typedef enum { NFA_BYTE, NFA_JUMP, NFA_SPLIT, NFA_ACCEPT } NfaKind;
typedef struct NfaState NfaState;
struct NfaState {
    size_t id;
    NfaKind kind;
    CharSet set;
    NfaState *out[2];
};

/* slot points TO the pointer that must eventually be connected. */
typedef struct Patch Patch;
struct Patch { NfaState **slot; Patch *next; };

typedef struct {
    NfaState *start;
    Patch *first, *last;
} Fragment;

typedef struct {
    Context *ctx;
    Vector states; /* NfaState* elements */
    NfaState *start, *accept;
} Nfa;

static NfaState *nfa_state(Nfa *nfa, NfaKind kind) {
    if (nfa->states.length >= RX_MAX_NFA) fail(nfa->ctx, "NFA state limit exceeded");
    NfaState *state = arena_alloc(nfa->ctx, sizeof *state);
    state->id = nfa->states.length;
    state->kind = kind;
    vector_push(nfa->ctx, &nfa->states, &state);
    return state;
}

static Fragment fragment_slot(Context *ctx, NfaState *start, NfaState **slot) {
    Patch *patch = arena_alloc(ctx, sizeof *patch);
    patch->slot = slot;
    return (Fragment){ .start = start, .first = patch, .last = patch };
}

static Fragment fragment_join(Fragment a, Fragment b) {
    if (!a.first) return b;
    if (!b.first) return a;
    a.last->next = b.first;
    a.last = b.last;
    return a;
}

static void fragment_patch(Fragment fragment, NfaState *target) {
    for (Patch *p = fragment.first; p; p = p->next) {
        assert(*p->slot == NULL);
        *p->slot = target;
    }
}

typedef Fragment (*BuildFunction)(Nfa *, const Ast *, Fragment, Fragment);
typedef struct { unsigned arity; BuildFunction build; } AstOperation;

static Fragment build_epsilon(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)node; (void)a; (void)b;
    NfaState *state = nfa_state(nfa, NFA_JUMP);
    return fragment_slot(nfa->ctx, state, &state->out[0]);
}

static Fragment build_set(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)a; (void)b;
    NfaState *state = nfa_state(nfa, NFA_BYTE);
    state->set = node->as.set;
    return fragment_slot(nfa->ctx, state, &state->out[0]);
}

static Fragment build_concat(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)nfa; (void)node;
    fragment_patch(a, b.start);
    b.start = a.start;
    return b;
}

static Fragment build_alt(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)node;
    NfaState *state = nfa_state(nfa, NFA_SPLIT);
    state->out[0] = a.start;
    state->out[1] = b.start;
    Fragment result = fragment_join(a, b);
    result.start = state;
    return result;
}

static Fragment build_star(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)node; (void)b;
    NfaState *state = nfa_state(nfa, NFA_SPLIT);
    state->out[0] = a.start;
    fragment_patch(a, state);
    return fragment_slot(nfa->ctx, state, &state->out[1]);
}

static Fragment build_plus(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)node; (void)b;
    NfaState *state = nfa_state(nfa, NFA_SPLIT);
    state->out[0] = a.start;
    fragment_patch(a, state);
    return fragment_slot(nfa->ctx, a.start, &state->out[1]);
}

static Fragment build_optional(Nfa *nfa, const Ast *node, Fragment a, Fragment b) {
    (void)node; (void)b;
    NfaState *state = nfa_state(nfa, NFA_SPLIT);
    state->out[0] = a.start;
    Fragment exit = fragment_slot(nfa->ctx, state, &state->out[1]);
    Fragment result = fragment_join(a, exit);
    result.start = state;
    return result;
}

static const AstOperation AST_OPERATIONS[AST_KIND_COUNT] = {
    [AST_EPSILON]  = { .arity = 0, .build = build_epsilon },
    [AST_SET]      = { .arity = 0, .build = build_set },
    [AST_CONCAT]   = { .arity = 2, .build = build_concat },
    [AST_ALT]      = { .arity = 2, .build = build_alt },
    [AST_STAR]     = { .arity = 1, .build = build_star },
    [AST_PLUS]     = { .arity = 1, .build = build_plus },
    [AST_OPTIONAL] = { .arity = 1, .build = build_optional }
};

typedef struct { const Ast *node; bool expanded; } BuildFrame;

/* Explicit postorder stack avoids C call-stack overflow on long aaaa... ASTs. */
static void nfa_compile(Context *ctx, Nfa *nfa, const Ast *root) {
    nfa->ctx = ctx;
    nfa->states.item_size = sizeof(NfaState *);
    Vector frames = { .item_size = sizeof(BuildFrame) };
    Vector results = { .item_size = sizeof(Fragment) };
    BuildFrame first = { .node = root };
    vector_push(ctx, &frames, &first);
    while (frames.length) {
        BuildFrame frame;
        vector_pop(&frames, &frame);
        const AstOperation *op = &AST_OPERATIONS[frame.node->kind];
        if (!frame.expanded) {
            BuildFrame expanded = { .node = frame.node, .expanded = true };
            vector_push(ctx, &frames, &expanded);
            if (op->arity == 2) {
                BuildFrame right = { .node = frame.node->as.pair.right };
                BuildFrame left = { .node = frame.node->as.pair.left };
                vector_push(ctx, &frames, &right);
                vector_push(ctx, &frames, &left);
            } else if (op->arity == 1) {
                BuildFrame child = { .node = frame.node->as.child };
                vector_push(ctx, &frames, &child);
            }
        } else {
            Fragment a = {0}, b = {0};
            if (op->arity == 2) vector_pop(&results, &b);
            if (op->arity >= 1) vector_pop(&results, &a);
            Fragment result = op->build(nfa, frame.node, a, b);
            vector_push(ctx, &results, &result);
        }
    }
    assert(results.length == 1);
    Fragment result;
    vector_pop(&results, &result);
    nfa->accept = nfa_state(nfa, NFA_ACCEPT);
    fragment_patch(result, nfa->accept);
    nfa->start = result.start;
}

typedef struct { unsigned char bytes[256]; size_t length; } Alphabet;

static Alphabet make_alphabet(const Nfa *left, const Nfa *right) {
    CharSet set = {{0}};
    const Nfa *nfas[] = {left, right};
    for (size_t side = 0; side < 2; ++side) {
        NfaState *const *states = nfas[side]->states.data;
        for (size_t i = 0; i < nfas[side]->states.length; ++i) {
            if (states[i]->kind != NFA_BYTE) continue;
            for (size_t j = 0; j < 4; ++j) set.words[j] |= states[i]->set.words[j];
        }
    }
    Alphabet alphabet = {0};
    for (unsigned byte = 0; byte < 256; ++byte) {
        if (charset_has(&set, byte)) alphabet.bytes[alphabet.length++] = (unsigned char)byte;
    }
    return alphabet;
}

typedef struct DfaState DfaState;
struct DfaState {
    size_t id;
    uint64_t hash;
    bool accepting;
    size_t *next;       /* indexed by Alphabet, not raw byte */
    uint64_t subset[]; /* flexible array of NFA-state bitset words */
};

typedef struct {
    Context *ctx;
    const Nfa *nfa;
    const Alphabet *alphabet;
    size_t word_count;
    Vector states; /* DfaState* elements */
    DfaState **buckets;
    size_t bucket_count;
    uint64_t *scratch;
    NfaState **pending;
    size_t pending_count;
    size_t initial;
} Dfa;

static uint64_t hash_subset(const uint64_t *words, size_t count) {
    uint64_t hash = UINT64_C(14695981039346656037);
    for (size_t i = 0; i < count; ++i) {
        uint64_t word = words[i];
        for (unsigned j = 0; j < 8; ++j) {
            hash ^= word & UINT64_C(255);
            hash *= UINT64_C(1099511628211);
            word >>= 8;
        }
    }
    return hash;
}

static bool subset_has(const uint64_t *subset, size_t id) {
    return (subset[id / 64] & (UINT64_C(1) << (id % 64))) != 0;
}

static void closure_enqueue(Dfa *dfa, NfaState *state) {
    if (!state || subset_has(dfa->scratch, state->id)) return;
    dfa->scratch[state->id / 64] |= UINT64_C(1) << (state->id % 64);
    assert(dfa->pending_count < dfa->nfa->states.length);
    dfa->pending[dfa->pending_count++] = state;
}

static void closure_finish(Dfa *dfa) {
    while (dfa->pending_count) {
        NfaState *state = dfa->pending[--dfa->pending_count];
        switch (state->kind) {
            case NFA_SPLIT:
                closure_enqueue(dfa, state->out[1]);
                /* fall through */
            case NFA_JUMP:
                closure_enqueue(dfa, state->out[0]);
                break;
            case NFA_BYTE:
            case NFA_ACCEPT:
                break;
        }
    }
}

static void dfa_rehash(Dfa *dfa, size_t capacity) {
    DfaState **buckets = arena_array(dfa->ctx, capacity, sizeof *buckets);
    DfaState *const *states = dfa->states.data;
    for (size_t i = 0; i < dfa->states.length; ++i) {
        size_t slot = (size_t)states[i]->hash & (capacity - 1);
        while (buckets[slot]) slot = (slot + 1) & (capacity - 1);
        buckets[slot] = states[i];
    }
    dfa->buckets = buckets;
    dfa->bucket_count = capacity;
}

static size_t dfa_intern(Dfa *dfa) {
    uint64_t hash = hash_subset(dfa->scratch, dfa->word_count);
    size_t slot = (size_t)hash & (dfa->bucket_count - 1);
    size_t bytes = checked_mul(dfa->ctx, dfa->word_count, sizeof(uint64_t));
    while (dfa->buckets[slot]) {
        DfaState *state = dfa->buckets[slot];
        if (state->hash == hash && memcmp(state->subset, dfa->scratch, bytes) == 0) {
            return state->id;
        }
        slot = (slot + 1) & (dfa->bucket_count - 1);
    }
    if (dfa->states.length >= RX_MAX_DFA) fail(dfa->ctx, "DFA state limit exceeded");
    if (dfa->states.length + 1 > dfa->bucket_count / 2) {
        dfa_rehash(dfa, checked_mul(dfa->ctx, dfa->bucket_count, 2));
        slot = (size_t)hash & (dfa->bucket_count - 1);
        while (dfa->buckets[slot]) slot = (slot + 1) & (dfa->bucket_count - 1);
    }
    size_t allocation = checked_add(dfa->ctx, sizeof(DfaState), bytes);
    DfaState *state = arena_alloc(dfa->ctx, allocation);
    state->id = dfa->states.length;
    state->hash = hash;
    state->accepting = subset_has(dfa->scratch, dfa->nfa->accept->id);
    memcpy(state->subset, dfa->scratch, bytes);
    state->next = arena_array(dfa->ctx, dfa->alphabet->length, sizeof *state->next);
    for (size_t i = 0; i < dfa->alphabet->length; ++i) state->next[i] = NO_INDEX;
    vector_push(dfa->ctx, &dfa->states, &state);
    dfa->buckets[slot] = state;
    return state->id;
}

static void dfa_init(Context *ctx, Dfa *dfa, const Nfa *nfa,
                     const Alphabet *alphabet) {
    dfa->ctx = ctx;
    dfa->nfa = nfa;
    dfa->alphabet = alphabet;
    dfa->word_count = (nfa->states.length + 63) / 64;
    dfa->states.item_size = sizeof(DfaState *);
    dfa->scratch = arena_array(ctx, dfa->word_count, sizeof *dfa->scratch);
    dfa->pending = arena_array(ctx, nfa->states.length, sizeof *dfa->pending);
    dfa_rehash(dfa, 16);
    closure_enqueue(dfa, nfa->start);
    closure_finish(dfa);
    dfa->initial = dfa_intern(dfa);
}

static DfaState *dfa_at(const Dfa *dfa, size_t id) {
    assert(id < dfa->states.length);
    return ((DfaState **)dfa->states.data)[id];
}

static size_t dfa_step(Dfa *dfa, size_t id, size_t symbol) {
    DfaState *from = dfa_at(dfa, id);
    if (from->next[symbol] != NO_INDEX) return from->next[symbol];
    ++dfa->ctx->evaluated_transitions;
    memset(dfa->scratch, 0, dfa->word_count * sizeof *dfa->scratch);
    assert(dfa->pending_count == 0);
    unsigned char byte = dfa->alphabet->bytes[symbol];
    NfaState *const *states = dfa->nfa->states.data;
    for (size_t i = 0; i < dfa->nfa->states.length; ++i) {
        NfaState *state = states[i];
        if (state->kind == NFA_BYTE && subset_has(from->subset, i) &&
            charset_has(&state->set, byte)) {
            closure_enqueue(dfa, state->out[0]);
        }
    }
    closure_finish(dfa);
    size_t destination = dfa_intern(dfa);
    from->next[symbol] = destination;
    return destination;
}

typedef struct {
    size_t left, right, parent, depth;
    unsigned char via;
} ProductNode;

typedef struct {
    Context *ctx;
    Vector nodes; /* ProductNode elements; also the BFS queue */
    size_t *buckets; /* node index + 1; zero means empty */
    size_t bucket_count;
} Product;

typedef struct { size_t id; bool inserted; } InternResult;

static uint64_t mix64(uint64_t value) {
    value ^= value >> 30;
    value *= UINT64_C(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value *= UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

static uint64_t product_hash(size_t left, size_t right) {
    return mix64((uint64_t)left) ^ mix64((uint64_t)right + UINT64_C(0x9e3779b97f4a7c15));
}

static void product_rehash(Product *product, size_t capacity) {
    size_t *buckets = arena_array(product->ctx, capacity, sizeof *buckets);
    const ProductNode *nodes = product->nodes.data;
    for (size_t i = 0; i < product->nodes.length; ++i) {
        size_t slot = (size_t)product_hash(nodes[i].left, nodes[i].right) & (capacity - 1);
        while (buckets[slot]) slot = (slot + 1) & (capacity - 1);
        buckets[slot] = i + 1;
    }
    product->buckets = buckets;
    product->bucket_count = capacity;
}

static InternResult product_intern(Product *product, ProductNode node) {
    size_t slot = (size_t)product_hash(node.left, node.right) & (product->bucket_count - 1);
    const ProductNode *nodes = product->nodes.data;
    while (product->buckets[slot]) {
        size_t id = product->buckets[slot] - 1;
        if (nodes[id].left == node.left && nodes[id].right == node.right) {
            return (InternResult){ .id = id, .inserted = false };
        }
        slot = (slot + 1) & (product->bucket_count - 1);
    }
    if (product->nodes.length >= RX_MAX_PRODUCT) fail(product->ctx, "product state limit exceeded");
    if (product->nodes.length + 1 > product->bucket_count / 2) {
        product_rehash(product, checked_mul(product->ctx, product->bucket_count, 2));
        slot = (size_t)product_hash(node.left, node.right) & (product->bucket_count - 1);
        while (product->buckets[slot]) slot = (slot + 1) & (product->bucket_count - 1);
    }
    size_t id = product->nodes.length;
    vector_push(product->ctx, &product->nodes, &node);
    product->buckets[slot] = id + 1;
    return (InternResult){ .id = id, .inserted = true };
}

static bool acceptance_differs(const Dfa *left, const Dfa *right,
                               size_t left_id, size_t right_id) {
    return dfa_at(left, left_id)->accepting != dfa_at(right, right_id)->accepting;
}

static size_t compare_languages(Context *ctx, Dfa *left, Dfa *right,
                               Product *product) {
    product->ctx = ctx;
    product->nodes.item_size = sizeof(ProductNode);
    product_rehash(product, 16);
    ProductNode initial = {
        .left = left->initial, .right = right->initial, .parent = NO_INDEX
    };
    InternResult first = product_intern(product, initial);
    if (acceptance_differs(left, right, initial.left, initial.right)) return first.id;
    for (size_t head = 0; head < product->nodes.length; ++head) {
        /* Copy: vector growth can invalidate pointers into its old storage. */
        ProductNode current = ((ProductNode *)product->nodes.data)[head];
        for (size_t symbol = 0; symbol < left->alphabet->length; ++symbol) {
            size_t a = dfa_step(left, current.left, symbol);
            size_t b = dfa_step(right, current.right, symbol);
            ProductNode next = {
                .left = a, .right = b, .parent = head,
                .depth = checked_add(ctx, current.depth, 1),
                .via = left->alphabet->bytes[symbol]
            };
            InternResult found = product_intern(product, next);
            if (found.inserted && acceptance_differs(left, right, a, b)) return found.id;
        }
    }
    return NO_INDEX;
}

typedef struct { const unsigned char *text; size_t length; } Pattern;

static Pattern read_pattern(Context *ctx, unsigned input_number) {
    Vector line = { .item_size = sizeof(unsigned char) };
    int c;
    while ((c = fgetc(stdin)) != EOF && c != '\n') {
        if (line.length >= (size_t)RX_MAX_PATTERN + 1) fail(ctx, "regex line too long");
        unsigned char byte = (unsigned char)c;
        vector_push(ctx, &line, &byte);
    }
    if (ferror(stdin)) fail(ctx, "input error: %s", strerror(errno));
    if (c == EOF && !line.length) fail(ctx, "missing regex line %u", input_number);
    unsigned char *data = line.data;
    if (line.length && data[line.length - 1] == '\r') --line.length;
    if (line.length > RX_MAX_PATTERN) fail(ctx, "regex line too long");
    return (Pattern){ .text = data, .length = line.length };
}

static void print_quoted(const unsigned char *text, size_t length) {
    putchar('"');
    for (size_t i = 0; i < length; ++i) {
        unsigned char c = text[i];
        switch (c) {
            case '\\': fputs("\\\\", stdout); break;
            case '"': fputs("\\\"", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            default:
                if (c >= 32 && c <= 126) putchar(c);
                else printf("\\x%02X", (unsigned)c);
        }
    }
    putchar('"');
}

static void print_result(Context *ctx, const Dfa *left, const Product *product,
                         size_t mismatch) {
    if (mismatch == NO_INDEX) {
        puts("EQUIVALENT");
        return;
    }
    const ProductNode *nodes = product->nodes.data;
    size_t length = nodes[mismatch].depth;
    unsigned char *witness = arena_array(ctx, length, sizeof *witness);
    size_t id = mismatch;
    for (size_t i = length; i; --i) {
        witness[i - 1] = nodes[id].via;
        id = nodes[id].parent;
    }
    assert(nodes[id].parent == NO_INDEX);
    puts("NOT EQUIVALENT");
    fputs("WITNESS ", stdout);
    print_quoted(witness, length);
    printf("\nLENGTH %zu\nACCEPTED_BY %d\n", length,
           dfa_at(left, nodes[mismatch].left)->accepting ? 1 : 2);
}

static void print_help(const char *program) {
    printf("Usage: %s [--stats] < input.txt\n", program);
    puts("Read two regex lines; a blank line or () denotes epsilon.");
    puts("Operators: concatenation, |, *, +, ?, (), ., [], [^], [a-z].");
    puts("Escapes: \\n \\r \\t \\a \\b \\f \\v \\0 \\xHH and escaped literals.");
    puts("Entire strings are matched; alphabet is all 256 byte values.");
    puts("[] denotes the empty language. Dot matches every byte.");
    puts("Whitespace is literal; ^ $ { } are literal outside character classes.");
    puts("Different languages produce a shortest witness; --stats uses stderr.");
}

int main(int argc, char **argv) {
    bool stats = false;
    if (argc == 2 && strcmp(argv[1], "--help") == 0) {
        print_help(argv[0]);
        return 0;
    }
    if (argc == 2 && strcmp(argv[1], "--stats") == 0) stats = true;
    else if (argc != 1) {
        fprintf(stderr, "Usage: %s [--stats] < input.txt\n", argv[0]);
        return 2;
    }
    Context *ctx = calloc(1, sizeof *ctx);
    if (!ctx) {
        fputs("ERROR: out of memory\n", stderr);
        return 2;
    }
    ctx->stats = stats;
    clock_t start = clock();
    Pattern patterns[2];
    Ast *roots[2];
    Nfa nfas[2] = {{0}};
    Dfa dfas[2] = {{0}};
    for (unsigned i = 0; i < 2; ++i) {
        patterns[i] = read_pattern(ctx, i + 1);
        roots[i] = parse_regex(ctx, patterns[i].text, patterns[i].length, i + 1);
        nfa_compile(ctx, &nfas[i], roots[i]);
    }
    Alphabet alphabet = make_alphabet(&nfas[0], &nfas[1]);
    /* A byte absent from both NFAs can only lead to rejection on both sides. */
    dfa_init(ctx, &dfas[0], &nfas[0], &alphabet);
    dfa_init(ctx, &dfas[1], &nfas[1], &alphabet);
    Product product = {0};
    size_t mismatch = compare_languages(ctx, &dfas[0], &dfas[1], &product);
    print_result(ctx, &dfas[0], &product, mismatch);
    if (ctx->stats) {
        fprintf(stderr, "NFA states: %zu / %zu\n", nfas[0].states.length, nfas[1].states.length);
        fprintf(stderr, "DFA states discovered: %zu / %zu\n", dfas[0].states.length, dfas[1].states.length);
        fprintf(stderr, "Product states discovered: %zu\nAlphabet bytes: %zu\n",
                product.nodes.length, alphabet.length);
        fprintf(stderr, "Computed DFA transitions: %" PRIu64 "\nArena bytes: %zu\n",
                ctx->evaluated_transitions, ctx->allocated);
        clock_t finish = clock();
        if (start != (clock_t)-1 && finish != (clock_t)-1) {
            fprintf(stderr, "CPU seconds: %.6f\n", (double)(finish - start) / CLOCKS_PER_SEC);
        }
    }
    if (fflush(stdout) == EOF) fail(ctx, "output error: %s", strerror(errno));
    arena_destroy(ctx);
    free(ctx);
    return 0;
}
