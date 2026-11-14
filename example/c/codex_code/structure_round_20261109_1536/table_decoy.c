#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

int main(void){int lookup[6]={3,1,4,0,2,5},values[6]={4,7,1,9,3,8};int total=0;
 for(int i=0;i<6;i++)total+=values[lookup[i]];
 printf("%d\n",total);return 0;}

