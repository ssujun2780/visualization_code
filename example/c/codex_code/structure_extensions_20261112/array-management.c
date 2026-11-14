#include <stdio.h>
int p[4],r[4],s[4],other[4];
int f(int x){return p[x]==x?x:(p[x]=f(p[x]));}
void join(int x,int y){x=f(x);y=f(y);if(x==y)return;if(r[x]<r[y]){int t=x;x=y;y=t;}p[y]=x;s[x]+=s[y];if(r[x]==r[y])r[x]++;other[x]++;}
int main(void){for(int i=0;i<4;i++){p[i]=i;s[i]=1;}join(0,1);join(2,3);join(0,2);printf("%d %d %d ",s[0],r[0],other[0]);return 0;}