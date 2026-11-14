#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct{int key,value;unsigned char state;}Slot;
void put(Slot*a,int key,int value){int i=key%7,first=-1;while(a[i].state){if(a[i].state==2&&first<0)first=i;if(a[i].state==1&&a[i].key==key){a[i].value=value;return;}i=(i+1)%7;}if(first>=0)i=first;a[i]=(Slot){key,value,1};}
int get(Slot*a,int key){int i=key%7;while(a[i].state){if(a[i].state==1&&a[i].key==key)return a[i].value;i=(i+1)%7;}return -1;}
int main(void){Slot a[7]={0};put(a,1,10);put(a,8,20);put(a,15,30);a[2].state=2;put(a,22,40);printf("%d %d %d %d\n",get(a,1),get(a,8),get(a,15),get(a,22));return 0;}
