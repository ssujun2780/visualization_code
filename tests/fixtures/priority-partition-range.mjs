// Expectations are derived from C operations before running inference.
export const cases = [
 {id:'heap-zero',family:'heap',stdout:'9 9 2 4 ',expected:{degree:2,base:0,order:'max',values:[9,9,2,4]},source:String.raw`#include <stdio.h>
int v[12],n;
void insert(int x){int i=n++;v[i]=x;while(i){int p=(i-1)/2;if(v[p]>=v[i])break;int t=v[p];v[p]=v[i];v[i]=t;i=p;}}
int main(void){insert(4);insert(9);insert(2);insert(9);for(int i=0;i<n;i++)printf("%d ",v[i]);return 0;}`},
 {id:'heap-shift',family:'heap',stdout:'2 9 4 9 ',expected:{degree:2,base:1,order:'min',values:[2,9,4,9]},source:String.raw`#include <stdio.h>
int v[12],n;
void insert(int x){int i=++n;v[i]=x;while(i>1){int p=i>>1;if(v[p]<=v[i])break;int t=v[p];v[p]=v[i];v[i]=t;i=p;}}
int main(void){insert(4);insert(9);insert(2);insert(9);for(int i=1;i<=n;i++)printf("%d ",v[i]);return 0;}`},
 {id:'heap-ternary',family:'heap',stdout:'-1 2 4 4 9 ',expected:{degree:3,base:0,order:'min',values:[-1,2,4,4,9]},source:String.raw`#include <stdio.h>
int v[13],n;
void insert(int x){int i=n++;v[i]=x;while(i){int p=(i-1)/3;if(v[p]<=v[i])break;int t=v[p];v[p]=v[i];v[i]=t;i=p;}}
int main(void){insert(4);insert(9);insert(2);insert(4);insert(-1);for(int i=0;i<n;i++)printf("%d ",v[i]);return 0;}`},
 {id:'partition-self',family:'partition',stdout:'0 0 0 0 4 4 ',expected:{roots:[0,0,0,0,4,4],groups:[[0,1,2,3],[4,5]]},source:String.raw`#include <stdio.h>
int v[6];
int lookup(int x){if(v[x]==x)return x;return v[x]=lookup(v[x]);}
void join(int x,int y){x=lookup(x);y=lookup(y);if(x!=y)v[y]=x;}
int main(void){for(int i=0;i<6;i++)v[i]=i;join(0,1);join(2,3);join(0,2);join(4,5);for(int i=0;i<6;i++)printf("%d ",lookup(i));return 0;}`},
 {id:'partition-negative',family:'partition',stdout:'0 0 0 3 3 5 ',expected:{roots:[0,0,0,3,3,5],groups:[[0,1,2],[3,4],[5]]},source:String.raw`#include <stdio.h>
int v[6]={-1,-1,-1,-1,-1,-1};
int lookup(int x){int y=x;while(v[y]>=0)y=v[y];while(x!=y){int t=v[x];v[x]=y;x=t;}return y;}
void join(int a,int b){a=lookup(a);b=lookup(b);if(a==b)return;if(v[a]>v[b]){int t=a;a=b;b=t;}v[a]+=v[b];v[b]=a;}
int main(void){join(0,1);join(0,2);join(3,4);for(int i=0;i<6;i++)printf("%d ",lookup(i));return 0;}`},
 {id:'parent-only',family:'negative',stdout:'0 0 0 0 ',expected:{absent:['disjoint-set','hash-table']},source:String.raw`#include <stdio.h>
int v[4]={0,0,1,2};
int lookup(int x){while(v[x]!=x)x=v[x];return x;}
int main(void){for(int i=0;i<4;i++)printf("%d ",lookup(i));return 0;}`},
 {id:'segment-recursive',family:'range',stdout:'10 14 ',expected:{range:[0,4],initial:10,final:14},source:String.raw`#include <stdio.h>
int a[4]={1,2,3,4},v[16];
void build(int k,int l,int r){if(r-l==1){v[k]=a[l];return;}int m=(l+r)/2;build(2*k,l,m);build(2*k+1,m,r);v[k]=v[2*k]+v[2*k+1];}
void change(int k,int l,int r,int p,int x){if(r-l==1){v[k]=x;return;}int m=(l+r)/2;if(p<m)change(2*k,l,m,p,x);else change(2*k+1,m,r,p,x);v[k]=v[2*k]+v[2*k+1];}
int main(void){build(1,0,4);printf("%d ",v[1]);change(1,0,4,1,6);printf("%d ",v[1]);return 0;}`},
 {id:'segment-iterative',family:'range',stdout:'14 18 ',expected:{range:[0,4],initial:14,final:18},source:String.raw`#include <stdio.h>
int a[4]={2,3,4,5},v[8];
int main(void){for(int i=0;i<4;i++)v[4+i]=a[i];for(int i=3;i>0;i--)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);
v[5]=7;for(int i=2;i;i/=2)v[i]=v[2*i]+v[2*i+1];printf("%d ",v[1]);return 0;}`},
 {id:'fenwick',family:'range',stdout:'6 14 ',expected:{range:[0,4],initial:10,final:14,prefix:6},source:String.raw`#include <stdio.h>
int a[4]={1,2,3,4},v[5];
void add(int p,int d){for(int i=p;i<=4;i+=i&-i)v[i]+=d;}
int total(int i){int s=0;while(i){s+=v[i];i-=i&-i;}return s;}
int main(void){for(int i=0;i<4;i++)add(i+1,a[i]);printf("%d ",total(3));add(2,4);printf("%d ",total(4));return 0;}`},
 {id:'values-only',family:'negative',stdout:'10 3 ',expected:{absent:['min-heap','max-heap','disjoint-set','segment-tree','fenwick-tree']},source:String.raw`#include <stdio.h>
int v[7]={10,3,7,1,2,3,4};int main(void){printf("%d %d ",v[0],v[1]);return 0;}`},
];
