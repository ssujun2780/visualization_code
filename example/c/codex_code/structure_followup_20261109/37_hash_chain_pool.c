#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int head[3]={-1,-1,-1},key[8],value[8],next[8],used;
void put(int k,int v){int i=used++;key[i]=k;value[i]=v;int b=k%3;next[i]=head[b];head[b]=i;}
int get(int k){for(int i=head[k%3];i!=-1;i=next[i])if(key[i]==k)return value[i];return -1;}
int main(void){put(1,10);put(4,40);put(7,70);put(2,20);printf("%d %d %d %d\n",get(1),get(4),get(7),get(2));return 0;}
