#include <stdio.h>
typedef struct{int y,x;} Point;
int main(void){int h,w,a[4][4],d[4][4],dy[4]={0,1,0,-1},dx[4]={1,0,-1,0};Point q[16];int front=0,back=0;
 if(scanf("%d%d",&h,&w)!=2||h<1||h>4||w<1||w>4)return 1;
 for(int y=0;y<h;y++){for(int x=0;x<w;x++){if(scanf("%d",&a[y][x])!=1)return 1;d[y][x]=-1;}}
 if(a[0][0])return 1;
 d[0][0]=0;q[back++]=(Point){0,0};
 while(front<back){Point p=q[front++];for(int k=0;k<4;k++){int y=p.y+dy[k],x=p.x+dx[k];if(y<0||y>=h||x<0||x>=w||a[y][x]||d[y][x]!=-1)continue;
   d[y][x]=d[p.y][p.x]+1; /* @trace:discover */
   q[back++]=(Point){y,x};
 }}printf("%d\n",d[h-1][w-1]);return 0;}
