#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{char tag;int value;short count;} Record;
int main(void){Record a,b;memset(&a,0,sizeof a);a.tag='x';a.value=123;a.count=7;for(int i=0;i<4;i++){memcpy(&b,&a,sizeof a);memcpy(&a,&b,sizeof a);}printf("%c %d %d %d\n",a.tag,a.value,a.count,memcmp(&a,&b,sizeof a)==0);return 0;}
