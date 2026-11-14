#include <stdio.h>
int main(void) {
    int stuff[5][3] = {{2,0,1},{5,1,1},{1,0,1},{8,1,1},{3,0,1}};
    int hop[5], parent[5] = {-1,0,0,1,1};
    int buckets[2] = {-1,-1};
    int line[5], done[5] = {0}, log[5] = {0};
    /* Build two lists backwards, manually. */
    for (int i=4;i>=0;i--) {
        int g=stuff[i][1];
        hop[i]=buckets[g];
        buckets[g]=i;
    }
    int sum=0;
    for(int group=0;group<2;group++) {
        int at=buckets[group];
        while(at!=-1) {
            sum+=stuff[at][0];
            at=hop[at];
        }
    }
    /* Copy indices and sort by repeated full scan. */
    for(int i=0;i<5;i++) line[i]=i;
    for(int i=0;i<5;i++) {
        int best=i;
        for(int j=i+1;j<5;j++)
            if(stuff[line[j]][0]>stuff[line[best]][0]) best=j;
        int keep=line[i]; line[i]=line[best]; line[best]=keep;
    }
    int taken=0;
    /* Need multiple passes because high priority children appear first. */
    for(int pass=0;pass<5;pass++) {
        for(int pos=0;pos<5;pos++) {
            int task=line[pos];
            if(done[task]) continue;
            int need=parent[task];
            if(need==-1 || done[need]) {
                log[taken++]=task;
                done[task]=1;
            }
        }
    }
    int code=0;
    for(int i=0;i<taken;i++) code=code*10+log[i]+1;
    int left=0;
    for(int i=0;i<5;i++) if(!done[i]) left++;
    printf("%d %d %d\n",sum,code,left);
    /* Walk parent links too; hop and parent have different roles. */
    int depths=0;
    for(int i=0;i<5;i++) {
        int p=i;
        while(p!=-1) { depths+=stuff[p][0]; p=parent[p]; }
    }
    printf("%d\n",depths);
    return 0;
}
