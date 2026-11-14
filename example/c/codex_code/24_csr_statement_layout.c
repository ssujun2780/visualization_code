#include <stdio.h>
#define INF 1000000000
typedef struct {
int distance,vertex;
}
 Pair;

typedef struct {
Pair data[128];
int size;
}
 Heap;

static int less(Pair a,Pair b){
return a.distance<b.distance||(a.distance==b.distance&&a.vertex<b.vertex);
}

static void push(Heap*h,Pair x){
int i=h->size++;
while(i&&less(x,h->data[(i-1)/2])){
h->data[i]=h->data[(i-1)/2];
i=(i-1)/2;
}
h->data[i]=x;
}

static Pair pop(Heap*h){
Pair answer=h->data[0],last=h->data[--h->size];
int i=0;
while(2*i+1<h->size){
int c=2*i+1;
if(c+1<h->size&&less(h->data[c+1],h->data[c]))c++;
if(!less(h->data[c],last))break;
h->data[i]=h->data[c];
i=c;
}
if(h->size)h->data[i]=last;
return answer;
}

int main(void){
int n,m,from[60],to[60],weight[60],offset[13]={
0}
,cursor[12],target[60],edgeweight[60],dist[12];
Heap heap={
0}
;

 if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;

 for(int i=0;
i<m;
i++){
if(scanf("%d%d%d",&from[i],&to[i],&weight[i])!=3||from[i]<0||from[i]>=n||to[i]<0||to[i]>=n||weight[i]<0||weight[i]>20)return 1;
offset[from[i]+1]++;
}

 for(int i=1;
i<=n;
i++)offset[i]+=offset[i-1];

 for(int i=0;
i<n;
i++){
cursor[i]=offset[i];
dist[i]=INF;
}

 for(int i=0;
i<m;
i++){
int p=cursor[from[i]]++;
target[p]=to[i];
edgeweight[p]=weight[i];
}

 dist[0]=0;
push(&heap,(Pair){
0,0}
);

 while(heap.size){
Pair at=pop(&heap);
if(at.distance!=dist[at.vertex])continue;

  int selected=at.vertex;
 /* @trace:select */
  for(int p=offset[selected];
p<offset[selected+1];
p++){
int v=target[p],candidate=at.distance+edgeweight[p];
if(candidate<dist[v]){

   dist[v]=candidate;
 /* @trace:relax */
   push(&heap,(Pair){
candidate,v}
);

  }
}

 }

 for(int i=0;
i<n;
i++){
printf("%d%c",dist[i]==INF?-1:dist[i],i+1==n?'\n':' ');
}
return 0;
}


