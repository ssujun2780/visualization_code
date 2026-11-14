#include <stdio.h>
#include <stdlib.h>
typedef struct{int data[5];int count,head,tail,capacity;}Q;int main(void){Q q={{0},0,0,0,5};int s=0;q.data[q.count]=11;q.count=1+q.count;q.data[q.count]=22;q.count=1+q.count;q.data[q.count]=33;q.count=1+q.count;printf("first %d %d\n",q.count,q.data[q.count-1]);q.count=q.count-1;s+=q.data[q.count];q.data[q.count]=44;q.count=1+q.count;q.data[q.count]=55;q.count=1+q.count;printf("second %d %d\n",q.count,q.data[q.count-1]);while(q.count){q.count=q.count-1;s+=q.data[q.count];}printf("last %d %d\n",q.count,s);return 0;}
