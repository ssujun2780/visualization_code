#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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
