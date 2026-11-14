#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int v,l,r;}N;N pool[17];int scan(unsigned char*base,int at){if(at<0)return 0;N*p=(N*)(base+at);return p->v+scan(base,p->l)+scan(base,p->r);}int main(void){int v[17]={-1,12,-6,7,20,2,15,-3,10,-8,5,18,0,13,-5,8,21},a[17]={1,3,5,7,9,11,13,15,-1,-1,-1,-1,-1,-1,-1,-1,-1},b[17]={2,4,6,8,10,12,14,16,-1,-1,-1,-1,-1,-1,-1,-1,-1};for(int i=0;i<17;i++){pool[i].v=v[i];pool[i].l=a[i]<0?-1:a[i]*(int)sizeof(N);pool[i].r=b[i]<0?-1:b[i]*(int)sizeof(N);}printf("%d\n",scan((unsigned char*)pool,0));return 0;}
