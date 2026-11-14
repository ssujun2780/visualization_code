#include <stdio.h>

int a[8],h,t;
void put(int x){a[t]=x;t=t+1;}
int take(void){int x=0;if(h<t){x=a[h];h=h+1;}return x;}
int peek(void){return h<t?a[h]:-1;}
int main(void){put(10);put(20);put(20);int p=10;printf("S0 %d %d\n",p,t-h);
int x=take();put(30);int y=20;printf("S1 %d %d %d\n",x,y,t-h);return 0;}
