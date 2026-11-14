#include <stdio.h>
#include <stdlib.h>
#define INF 1000000000
typedef struct Edge{int to,weight;struct Edge*next;} Edge;
static void clear(Edge**row,int n){for(int i=0;i<n;i++)while(row[i]){Edge*e=row[i];row[i]=e->next;free(e);}}
int main(void){int n,m,d[12],used[12]={0};Edge*row[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n||w<0||w>20){clear(row,n);return 1;}Edge*e=malloc(sizeof*e);if(!e){clear(row,n);return 1;}*e=(Edge){b,w,row[a]};row[a]=e;}
 for(int i=0;i<n;i++)d[i]=INF;
 d[0]=0;
 for(int k=0;k<n;k++){int u=-1;for(int i=0;i<n;i++)if(!used[i]&&(u<0||d[i]<d[u]))u=i;if(u<0||d[u]==INF)break;
  int selected=u; /* @trace:select */
  used[selected]=1;
  for(Edge*e=row[selected];e;e=e->next){int candidate=d[selected]+e->weight;if(candidate<d[e->to]){
   d[e->to]=candidate; /* @trace:relax */
  }}
 }
 for(int i=0;i<n;i++){printf("%d%c",d[i]==INF?-1:d[i],i+1==n?'\n':' ');}clear(row,n);return 0;}
