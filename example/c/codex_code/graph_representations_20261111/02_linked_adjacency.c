#include <stdio.h>
#include <stdlib.h>
#define V 6
long d[V]; int seen[V];

typedef struct E{int weight;struct E*next;int to;}E;E*head[V];E pool[8];int used;
void put(int u,int v,int w){E*p=&pool[used++];p->to=v;p->weight=w;p->next=head[u];head[u]=p;}
void erase(int u,int v){E**p=&head[u];while(*p){if((*p)->to==v){*p=(*p)->next;return;}p=&(*p)->next;}}
void scan(const char*tag){for(int u=0;u<V;u++){d[u]=10000;seen[u]=0;} d[0]=0; int count=0,sum=0;
for(int u=0;u<V;u++)for(E*p=head[u];p;p=p->next){int v=p->to,w=p->weight;if(d[u]!=10000 && d[v]>d[u]+w){d[v]=d[u]+w;seen[v]=1;} count++;sum+=w;}
printf("%s %d %d\n",tag,count,sum);}
int main(void){put(0,1,0);put(0,2,4);put(1,3,-2);put(2,3,7);put(3,3,5);scan("P0");erase(0,2);put(4,2,9);scan("P1");return 0;}
