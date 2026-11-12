#include <stdio.h>
typedef struct{int v,hop;}N;
int count(N*a,int p){int n=0;while(p!=-1){n++;p=a[p].hop;}return n;}
int main(void){N a[6]={{1,-1},{1,-1},{1,0},{1,1},{1,2},{1,3}};int used=4,spare=5;
printf("S0 %d %d\n",count(a,used),count(a,spare));int x=spare;spare=a[x].hop;a[x].hop=used;used=x;
printf("S1 %d %d\n",count(a,used),count(a,spare));return 0;}
