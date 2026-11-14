#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int boxes[7],head,used;
void front(int x){head=(head+6)%7;boxes[head]=x;used++;}
void back(int x){boxes[(head+used)%7]=x;used++;}
int first(void){int x=boxes[head];head=(head+1)%7;used--;return x;}
int last(void){used--;return boxes[(head+used)%7];}
int main(void){front(2);back(3);front(1);int a=last(),b=first();back(4);int c=first(),d=first();printf("%d %d %d %d\n",a,b,c,d);return 0;}
