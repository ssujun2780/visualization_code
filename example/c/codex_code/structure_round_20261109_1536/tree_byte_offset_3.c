#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int v,l,r;}N;N pool[3];int scan(unsigned char*base,int at){if(at<0)return 0;N*p=(N*)(base+at);return p->v+scan(base,p->l)+scan(base,p->r);}int main(void){int v[3]={-1,12,-6},a[3]={1,-1,-1},b[3]={2,-1,-1};for(int i=0;i<3;i++){pool[i].v=v[i];pool[i].l=a[i]<0?-1:a[i]*(int)sizeof(N);pool[i].r=b[i]<0?-1:b[i]*(int)sizeof(N);}printf("%d\n",scan((unsigned char*)pool,0));return 0;}
