#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int key,value,flag;}Slot;
void put(Slot*a,int key,int value){int k=key%7;for(int n=0;n<7;n++,k=(k+1)%7)if(a[k].flag!=1||a[k].key==key){a[k]=(Slot){key,value,1};return;}}
int get(Slot*a,int key){int k=key%7;for(int n=0;n<7;n++,k=(k+1)%7){if(a[k].flag==0)return -1;if(a[k].flag==1&&a[k].key==key)return a[k].value;}return -1;}
int main(void){Slot table[7]={0};put(table,1,10);put(table,8,20);put(table,15,30);table[2].flag=2;put(table,22,40);printf("%d %d %d %d\n",get(table,1),get(table,8),get(table,15),get(table,22));return 0;}
