#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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
