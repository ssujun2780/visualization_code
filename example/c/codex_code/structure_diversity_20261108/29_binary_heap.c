#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],n;}H;
void put(H*h,int v){int i=h->n++;while(i>0){int p=(i-1)/2;if(h->a[p]<=v)break;h->a[i]=h->a[p];i=p;}h->a[i]=v;}
int take(H*h){int out=h->a[0],v=h->a[--h->n],i=0;while(2*i+1<h->n){int c=2*i+1;if(c+1<h->n&&h->a[c+1]<h->a[c])c++;if(v<=h->a[c])break;h->a[i]=h->a[c];i=c;}if(h->n)h->a[i]=v;return out;}
int main(void){H h={0};int in[5]={5,1,4,2,3};for(int i=0;i<5;i++)put(&h,in[i]);int out=0;while(h.n)out=out*10+take(&h);printf("%d\n",out);return 0;}
