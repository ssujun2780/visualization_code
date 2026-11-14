#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8555{int q8449;struct q8555*q8290;}q8555;
int main(void){q8555 tail={4,0},q7972={1,&tail},q8025={2,&tail};q8555*q7919[2]={&q7972,&q8025};int s=0;
for(int i=0;i<2;i++)for(q8555*p=q7919[i];p;p=p->q8290)s+=p->q8449;
printf("%d\n",s);return 0;}
