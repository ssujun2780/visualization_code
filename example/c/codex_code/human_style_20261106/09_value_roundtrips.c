#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int v[4];int total;}Packet;
Packet bump(Packet p,int x){p.v[0]+=x;p.total+=p.v[0];return p;}
int main(void){Packet original={{1,2,3,4},0};Packet changed=bump(bump(original,2),3);printf("%d %d %d\n",original.v[0],changed.v[0],changed.total);return 0;}
