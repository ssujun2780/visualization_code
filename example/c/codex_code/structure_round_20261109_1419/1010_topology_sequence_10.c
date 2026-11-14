#include <stdio.h>
typedef struct N{int key;struct N*a,*b;}N;typedef struct{int from,slot,to;}Change;
int main(void){N nodes[8];int left[8]={1,3,5,7,-1,-1,-1,-1},right[8]={2,4,6,-1,-1,-1,-1,-1};for(int i=0;i<8;i++){nodes[i].key=i+1;nodes[i].a=left[i]<0?0:nodes+left[i];nodes[i].b=right[i]<0?0:nodes+right[i];}N*root=nodes;Change edits[18]={{4,1,2},{5,0,-1},{2,1,4},{3,0,-1},{0,1,0},{1,0,7},{6,1,0},{7,0,7},{4,1,-1},{5,0,3},{2,1,6},{3,0,7},{0,1,6},{1,0,5},{6,1,4},{7,0,-1},{4,1,2},{5,0,1}};
for(int step=0;step<18;step++){Change c=edits[step];N*target=c.to<0?0:nodes+c.to;if(c.slot==0)nodes[c.from].a=target;else nodes[c.from].b=target;
int seen[8]={0},sum=0,count=0,h=0,t=0;N*q[8];q[t++]=root;seen[0]=1;while(h<t){N*p=q[h++];sum+=p->key;count++;N*next[2]={p->a,p->b};for(int k=0;k<2;k++)if(next[k]){int i=(int)(next[k]-nodes);if(!seen[i]){seen[i]=1;q[t++]=next[k];}}}
printf("%d %d %d\n",step,count,sum);}return 0;}
