#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int v,l,r;}N;N pool[10];int scan(unsigned char*base,int at){if(at<0)return 0;N*p=(N*)(base+at);return p->v+scan(base,p->l)+scan(base,p->r);}int main(void){int v[10]={-1,12,-6,7,20,2,15,-3,10,-8},a[10]={1,3,5,7,9,-1,-1,-1,-1,-1},b[10]={2,4,6,8,-1,-1,-1,-1,-1,-1};for(int i=0;i<10;i++){pool[i].v=v[i];pool[i].l=a[i]<0?-1:a[i]*(int)sizeof(N);pool[i].r=b[i]<0?-1:b[i]*(int)sizeof(N);}printf("%d\n",scan((unsigned char*)pool,0));return 0;}
