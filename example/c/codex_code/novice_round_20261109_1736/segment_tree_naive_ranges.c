#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int sum,left,right;}R;R a[20];int values[5]={2,3,5,7,11};
void make(int k,int l,int r){a[k].left=l;a[k].right=r;if(l==r){a[k].sum=values[l];return;}int m=(l+r)/2;make(k*2+1,l,m);make(k*2+2,m+1,r);a[k].sum=a[k*2+1].sum+a[k*2+2].sum;}
int query(int k,int l,int r){if(a[k].left>=l&&a[k].right<=r)return a[k].sum;if(a[k].right<l||a[k].left>r)return 0;return query(k*2+1,l,r)+query(k*2+2,l,r);}
int main(void){make(0,0,4);printf("%d %d\n",a[0].sum,query(0,1,3));return 0;}
