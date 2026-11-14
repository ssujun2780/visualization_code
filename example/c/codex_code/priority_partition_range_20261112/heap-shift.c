#include <stdio.h>
int v[12],n;
void insert(int x){int i=++n;v[i]=x;while(i>1){int p=i>>1;if(v[p]<=v[i])break;int t=v[p];v[p]=v[i];v[i]=t;i=p;}}
int main(void){insert(4);insert(9);insert(2);insert(9);for(int i=1;i<=n;i++)printf("%d ",v[i]);return 0;}