#include <stdio.h>
int first[5]={0,2,3,5,6},next[6]={1,-1,-1,4,-1,-1},to[6]={1,2,3,2,4,0};
int visited[5],queue[5];
void search(int source){
    int front=0,back=0;queue[back++]=source;visited[source]=1;
    while(front<back){
        int v=queue[front++];printf("%d ",v);
        for(int e=first[v];e!=-1;e=next[e]){
            int w=to[e];if(!visited[w]){visited[w]=1;queue[back++]=w;}
        }
    }
}
int main(void){first[4]=-1;search(0);puts("");return 0;}
