#include <stdio.h>
#include <stdlib.h>
int data[5],count=0,head=0,tail=0;int main(void){int s=0;data[tail]=11;tail++;tail%=5;count++;data[tail]=22;tail++;tail%=5;count++;data[tail]=33;tail++;tail%=5;count++;printf("first %d %d\n",count,data[head]);s+=data[head];head++;head%=5;count--;data[tail]=44;tail++;tail%=5;count++;data[tail]=55;tail++;tail%=5;count++;printf("second %d %d\n",count,data[head]);while(count){s+=data[head];head++;head%=5;count--;}printf("last %d %d\n",count,s);return 0;}
