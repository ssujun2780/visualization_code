#include <stdio.h>
#include <stdlib.h>
int data[5],count=0,head=0,tail=0;int main(void){int s=0;data[count]=11;count=1+count;data[count]=22;count=1+count;data[count]=33;count=1+count;printf("first %d %d\n",count,data[count-1]);count=count-1;s+=data[count];data[count]=44;count=1+count;data[count]=55;count=1+count;printf("second %d %d\n",count,data[count-1]);while(count){count=count-1;s+=data[count];}printf("last %d %d\n",count,s);return 0;}
