#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[5],head,tail,count;}Queue;
int main(void){Queue q={{0},0,0,0};for(int i=0;i<5;i++){q.data[q.tail]=i;q.tail=(q.tail+1)%5;q.count++;}printf("full %d\n",q.count);
int s=0;for(int i=0;i<3;i++){s+=q.data[q.head];q.head=(q.head+1)%5;q.count--;}
for(int i=0;i<2;i++){q.data[q.tail]=7;q.tail=(q.tail+1)%5;q.count++;}printf("wrapped %d %d\n",q.count,q.data[q.head]);
while(q.count){s+=q.data[q.head];q.head=(q.head+1)%5;q.count--;}printf("empty %d %d\n",q.count,s);return 0;}
