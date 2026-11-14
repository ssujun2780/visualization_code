#include <stdio.h>
int lifo[5],top=0,fifo[5],front=0,back=0;
void push(int v){lifo[top++]=v;}
int pop(void){return lifo[--top];}
void put(int v){fifo[back++]=v;}
int get(void){return fifo[front++];}
int main(void){
    push(4);push(9);push(2);put(5);put(8);put(7);
    printf("%d %d\n",pop(),get());
    push(6);put(1);printf("%d %d\n",pop(),get());
    printf("%d %d\n",pop(),get());return 0;
}
