#include <stdio.h>
int main(void){int n,parent[24],left[24],right[24];if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&parent[i])!=1||parent[i]<-100||parent[i]>100)return 1;left[i]=parent[i]+1;right[i]=parent[i]*2;}
 for(int i=0;i<n;i++){printf("%d%c",left[i]+right[i],i+1==n?'\n':' ');}return 0;}
