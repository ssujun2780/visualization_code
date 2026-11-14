#include <stdio.h>
#include <stdlib.h>
int data[5],count=0,head=0,tail=0;int main(void){int s=0;data[tail]=11;tail++;if(tail==5)tail=0;count++;data[tail]=22;tail++;if(tail==5)tail=0;count++;data[tail]=33;tail++;if(tail==5)tail=0;count++;printf("first %d %d\n",count,data[head]);s+=data[head];head++;if(head==5)head=0;count--;data[tail]=44;tail++;if(tail==5)tail=0;count++;data[tail]=55;tail++;if(tail==5)tail=0;count++;printf("second %d %d\n",count,data[head]);while(count){s+=data[head];head++;if(head==5)head=0;count--;}printf("last %d %d\n",count,s);return 0;}
