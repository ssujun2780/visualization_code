#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
int main(void) {
    int n=0, length=0, capacity=0, *data=NULL;
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    for(int i=0;i<n;i++) {
        if(length==capacity) {
            int next=capacity?capacity*2:1;
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
