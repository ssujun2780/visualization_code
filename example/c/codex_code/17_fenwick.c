#include <stdio.h>
static void add(int*t,int n,int p,int x){for(;p<=n;p+=p&-p){
 t[p]+=x; /* @trace:update */
}}
static int prefix(const int*t,int p){int sum=0;for(;p>0;p-=p&-p)sum+=t[p];return sum;}
int main(void){int n,a[32],t[33]={0};if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&a[i])!=1||a[i]<-100||a[i]>100)return 1;add(t,n,i+1,a[i]);}
 for(int i=1;i<=n;i++){printf("%d%c",prefix(t,i),i==n?'\n':' ');}return 0;}
