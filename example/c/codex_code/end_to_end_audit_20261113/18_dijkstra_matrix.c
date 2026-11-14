#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
enum { N=8, INF=1000000 };
static int weight(int u,int v) {
    if(u==v) return 0;
    if(v==u+1 || (u*7+v*3)%5==0) return 1+(u*11+v*7)%9;
    return INF;
}

int main(void) {
    int graph[N][N],dist[N],used[N]={0};
    for(int i=0;i<N;i++) {
        dist[i]=i?INF:0;
        for(int j=0;j<N;j++) graph[i][j]=weight(i,j);
    }
    for(int step=0;step<N;step++) {
        int u=-1;
        for(int i=0;i<N;i++) if(!used[i] && (u==-1 || dist[i]<dist[u])) u=i;
        if(u==-1 || dist[u]==INF) break;
        used[u]=1;
        for(int v=0;v<N;v++) {
            if(graph[u][v]!=INF && dist[v]>dist[u]+graph[u][v]) dist[v]=dist[u]+graph[u][v];
        }
    }
    for(int i=0;i<N;i++) printf("%d%c",dist[i],i==N-1?'\n':' ');
    return 0;
}
