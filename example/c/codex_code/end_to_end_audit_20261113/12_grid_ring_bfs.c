#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
int main(void) {
    int dist[20], queue[20], read=0, write=0, size=0;
    for(int i=0;i<20;i++) dist[i]=-1;
    dist[0]=0; queue[write++]=0; size++;
    const int dr[4]={-1,1,0,0}, dc[4]={0,0,-1,1};
    while(size) {
        int u=queue[read]; read=(read+1)%20; size--;
        for(int d=0;d<4;d++) {
            int r=u/5+dr[d],c=u%5+dc[d];
            if(r<0 || r>=4 || c<0 || c>=5) continue;
            int v=r*5+c;
            if(v==7 || v==12 || dist[v]!=-1) continue;
            dist[v]=dist[u]+1; queue[write]=v; write=(write+1)%20; size++;
        }
    }
    for(int i=0;i<20;i++) printf("%d%c",dist[i],i==19?'\n':' ');
    return 0;
}
