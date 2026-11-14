#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

struct{int boxes[7],head,used;} state;
void front(int x){state.head=(state.head+6)%7;state.boxes[state.head]=x;state.used++;}
void back(int x){state.boxes[(state.head+state.used)%7]=x;state.used++;}
int first(void){int x=state.boxes[state.head];state.head=(state.head+1)%7;state.used--;return x;}
int last(void){state.used--;return state.boxes[(state.head+state.used)%7];}
int main(void){front(2);back(3);front(1);int a=last(),b=first();back(4);int c=first(),d=first();printf("%d %d %d %d\n",a,b,c,d);return 0;}
