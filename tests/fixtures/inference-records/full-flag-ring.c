#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[3],h,t,full;void put(int x){if(full)return;a[t]=x;t=(t+1)%3;full=t==h;}int pop(void){if(h==t&&!full)return -1;int x=a[h];h=(h+1)%3;full=0;return x;}
int main(void){put(1);put(2);put(3);int x=pop(),y=pop();put(4);put(5);int z=pop(),u=pop(),v=pop();printf("%d %d %d %d %d\n",x,y,z,u,v);return 0;}