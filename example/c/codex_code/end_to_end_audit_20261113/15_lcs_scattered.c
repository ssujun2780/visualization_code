#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
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
