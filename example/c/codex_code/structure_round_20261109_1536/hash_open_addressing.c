#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct {int key,value;unsigned char used;} Slot;
Slot table[11];
void put(int k,int v){unsigned int at=(unsigned)k%11;while(table[at].used&&table[at].key!=k)at=(at+1)%11;table[at].used=1;table[at].key=k;table[at].value=v;}
int get(int k){unsigned int at=(unsigned)k%11;for(int step=0;step<11&&table[at].used;step++,at=(at+1)%11)if(table[at].key==k)return table[at].value;return -1;}
int main(void){put(0,4);put(11,5);put(22,6);put(3,7);put(11,8);printf("%d\n",get(0)+get(11)+get(22)+get(3));return 0;}

