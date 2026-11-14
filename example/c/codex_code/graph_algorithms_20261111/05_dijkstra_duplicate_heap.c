#include <stdio.h>

typedef struct Item{int key,v;}Item;
Item heap[20];int size;
int offsets[7]={0,2,3,5,6,6,6},targets[6]={1,2,3,1,3,4},weights[6]={10,1,2,1,9,0};
int distance[6],settled[6],stale;
void push(int v,int key){int k=size++;while(k>0){int p=(k-1)/2;if(heap[p].key<=key)break;heap[k]=heap[p];k=p;}heap[k]=(Item){key,v};}
Item pop(void){Item answer=heap[0],last=heap[--size];int k=0;while(2*k+1<size){int c=2*k+1;
if(c+1<size&&heap[c+1].key<heap[c].key)c++;if(last.key<=heap[c].key)break;heap[k]=heap[c];k=c;}if(size)heap[k]=last;return answer;}
int main(void){for(int i=0;i<6;i++)distance[i]=1000;distance[0]=0;push(0,0);
while(size){Item item=pop();int u=item.v;if(item.key!=distance[u]){stale++;continue;}settled[u]=1;
for(int k=offsets[u];k<offsets[u+1];k++){int v=targets[k],w=weights[k];if(distance[v]>distance[u]+w){distance[v]=distance[u]+w;push(v,distance[v]);}}
if(u==0)printf("A %d %d %d\n",distance[1],distance[2],settled[1]);}
printf("B %d %d %d %d %d %d %d\n",distance[0],distance[1],distance[2],distance[3],distance[4],distance[5],stale);return 0;}
