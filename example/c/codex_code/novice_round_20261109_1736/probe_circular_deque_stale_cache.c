#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int a[5],begin,end,n,cached;}Q;int main(void){Q q={0};q.cached=99;for(int i=1;i<=4;i++){q.a[q.end]=i;q.end=(q.end+1)%5;q.n++;}q.begin=(q.begin+2)%5;q.n-=2;for(int i=5;i<=7;i++){q.a[q.end]=i;q.end=(q.end+1)%5;q.n++;}int s=0;for(int k=0;k<q.n;k++)s=s*10+q.a[(q.begin+k)%5];printf("%d %d\n",s,q.cached);q.begin=(q.begin+4)%5;q.a[q.begin]=8; /* replacing first is intentional, no overflow */s=0;for(int k=0;k<q.n;k++)s+=q.a[(q.begin+k)%5];printf("%d\n",s);return 0;}
