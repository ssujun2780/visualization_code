#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int sums[32],lazy[32];
void build(int p,int l,int r){if(r-l==1){sums[p]=l+1;return;}int m=(l+r)/2;build(p*2,l,m);build(p*2+1,m,r);sums[p]=sums[p*2]+sums[p*2+1];}
void apply(int p,int l,int r,int x){sums[p]+=(r-l)*x;lazy[p]+=x;}
void push(int p,int l,int r){if(lazy[p]&&r-l>1){int m=(l+r)/2;apply(p*2,l,m,lazy[p]);apply(p*2+1,m,r,lazy[p]);lazy[p]=0;}}
void add(int p,int l,int r,int a,int b,int x){if(b<=l||r<=a)return;if(a<=l&&r<=b){apply(p,l,r,x);return;}push(p,l,r);int m=(l+r)/2;add(p*2,l,m,a,b,x);add(p*2+1,m,r,a,b,x);sums[p]=sums[p*2]+sums[p*2+1];}
int query(int p,int l,int r,int a,int b){if(b<=l||r<=a)return 0;if(a<=l&&r<=b)return sums[p];push(p,l,r);int m=(l+r)/2;return query(p*2,l,m,a,b)+query(p*2+1,m,r,a,b);}
int main(void){build(1,0,8);add(1,0,8,2,6,3);printf("%d %d\n",query(1,0,8,0,8),query(1,0,8,3,5));return 0;}
