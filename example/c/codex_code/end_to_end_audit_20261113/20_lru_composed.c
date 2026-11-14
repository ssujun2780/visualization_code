#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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
