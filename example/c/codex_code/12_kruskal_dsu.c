#include <stdio.h>
#include <stdlib.h>
typedef struct{int a,b,w,order;} Edge;
static int compare(const void*x,const void*y){const Edge*a=x,*b=y;return a->w!=b->w?(a->w>b->w)-(a->w<b->w):a->order-b->order;}
static int root(int*p,int v){while(p[v]!=v){p[v]=p[p[v]];v=p[v];}return v;}
int main(void){int n,m,p[12],size[12],total=0,components;Edge e[60];if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<m;i++){if(scanf("%d%d%d",&e[i].a,&e[i].b,&e[i].w)!=3||e[i].a<0||e[i].a>=n||e[i].b<0||e[i].b>=n||e[i].w<0||e[i].w>20)return 1;e[i].order=i;}
 for(int i=0;i<n;i++){p[i]=i;size[i]=1;}components=n;qsort(e,(size_t)m,sizeof e[0],compare);
 for(int i=0;i<m;i++){int a=root(p,e[i].a),b=root(p,e[i].b);if(a==b)continue;if(size[a]<size[b]){int temp=a;a=b;b=temp;}p[b]=a;size[a]+=size[b];components--;
  total+=e[i].w; /* @trace:total */
 }
 printf("%d %d\n",total,components);return 0;}
