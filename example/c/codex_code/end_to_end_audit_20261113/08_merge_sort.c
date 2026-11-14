#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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

int main(void) {
    int n=0,a[64];
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    for(int i=0;i<n;i++) a[i]=(i*13+7)%19-9;
    int tmp[64]; sort(a,tmp,0,n);
    for(int i=0;i<n;i++) printf("%d%c",a[i],i+1==n?'\n':' ');
    return 0;
}
