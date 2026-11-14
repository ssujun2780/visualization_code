#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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
