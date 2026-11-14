#include <stdio.h>
#include <stdlib.h>
int data[5],count=0,head=0,tail=0;int main(void){int s=0;data[tail]=11;tail=1+tail;tail%=5;count=1+count;data[tail]=22;tail=1+tail;tail%=5;count=1+count;data[tail]=33;tail=1+tail;tail%=5;count=1+count;printf("first %d %d\n",count,data[head]);s+=data[head];head=1+head;head%=5;count=count-1;data[tail]=44;tail=1+tail;tail%=5;count=1+count;data[tail]=55;tail=1+tail;tail%=5;count=1+count;printf("second %d %d\n",count,data[head]);while(count){s+=data[head];head=1+head;head%=5;count=count-1;}printf("last %d %d\n",count,s);return 0;}
