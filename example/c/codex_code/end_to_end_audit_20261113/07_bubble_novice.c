#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
int main(void) {
    int n=0,a[64];
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    for(int i=0;i<n;i++) a[i]=(i*13+7)%19-9;

    for(int i=0;i<n;i++)
        for(int j=0;j+1<n;j++)
            if(a[j]>a[j+1]) {
                int temp=a[j]; a[j]=a[j+1]; a[j+1]=temp;
            }

    for(int i=0;i<n;i++) printf("%d%c",a[i],i+1==n?'\n':' ');
    return 0;
}
