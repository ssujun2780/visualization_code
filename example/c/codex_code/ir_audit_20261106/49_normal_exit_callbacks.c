#include <stdio.h>
#include <stdlib.h>
int state=0;
void first(void){state+=1;printf("first:%d\n",state);}
void second(void){state+=10;printf("second:%d\n",state);}
int main(void){
 if(atexit(first)!=0||atexit(second)!=0)return 1;
 puts("before");exit(0);
 puts("after");return 0;
}
