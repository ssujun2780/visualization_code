#include <stdio.h>
#include <stdint.h>
int main(void){int n,m;uint64_t rows[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<n;i++)rows[i]=UINT64_C(1)<<i;
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n)return 1;rows[a]|=UINT64_C(1)<<b;}
 for(int k=0;k<n;k++)for(int i=0;i<n;i++)if(rows[i]&(UINT64_C(1)<<k))rows[i]|=rows[k];
 for(int i=0;i<n;i++){int count=0;for(int j=0;j<n;j++)if(rows[i]&(UINT64_C(1)<<j))count++;printf("%d%c",count,i+1==n?'\n':' ');}return 0;}
