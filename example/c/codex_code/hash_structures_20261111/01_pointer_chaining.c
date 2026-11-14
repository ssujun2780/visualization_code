#include <stdio.h>
typedef struct Entry{int key,value;struct Entry *next;}Entry;
Entry records[6];Entry *buckets[5];int used;
void insert(int k,int v){int b=k%5;Entry*p=&records[used++];p->key=k;p->value=v;p->next=buckets[b];buckets[b]=p;}
int lookup(int k){for(Entry*p=buckets[k%5];p;p=p->next)if(p->key==k)return p->value;return -1;}
int main(void){insert(1,10);insert(6,60);insert(11,110);insert(2,20);printf("A %d %d %d\n",lookup(6),(int)(buckets[1]-records),(int)(buckets[2]-records));return 0;}
