#include <stdio.h>
typedef struct{int data[8];int front,back,count;} Ring;
static int take(Ring*q){int v=q->data[q->front];q->front=(q->front+1)%8;q->count--;return v;}
static void put(Ring*q,int v){q->data[q->back]=v;q->back=(q->back+1)%8;q->count++;}
int main(void){int h,w,a[64],d[64],dr[4]={0,1,0,-1},dc[4]={1,0,-1,0};Ring queue={0};
 if(scanf("%d%d",&h,&w)!=2||h<1||h>4||w<1||w>4)return 1;
 for(int i=0;i<h*w;i++){if(scanf("%d",&a[i])!=1)return 1;d[i]=-1;}if(a[0])return 1;
 d[0]=0;put(&queue,0);
 while(queue.count){int u=take(&queue);for(int k=0;k<4;k++){int y=u/w+dr[k],x=u%w+dc[k];if(y<0||y>=h||x<0||x>=w)continue;int v=y*w+x;if(a[v]||d[v]!=-1)continue;
   d[v]=d[u]+1; /* @trace:discover */
   if(queue.count==8)return 1;
   put(&queue,v);
 }}printf("%d\n",d[h*w-1]);return 0;}
