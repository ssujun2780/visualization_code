#include <stdio.h>
typedef struct {int value,state,key;}Slot;Slot table[7];
int locate(int key){int i=key%7;for(int n=0;n<7;n++,i=(i+1)%7){if(table[i].state==0)return -1;if(table[i].state==1&&table[i].key==key)return i;}return -1;}
void put(int key,int value){int i=key%7,hole=-1;for(int n=0;n<7;n++,i=(i+1)%7){if(table[i].state==2&&hole<0)hole=i;if(table[i].state==0){if(hole>=0)i=hole;table[i]=(Slot){value,1,key};return;}if(table[i].state==1&&table[i].key==key){table[i].value=value;return;}}}
int main(void){put(1,10);put(8,80);put(15,150);table[locate(8)].state=2;printf("A %d %d\n",locate(15),table[2].state);put(22,220);printf("B %d %d %d\n",locate(15),locate(22),locate(8));return 0;}
