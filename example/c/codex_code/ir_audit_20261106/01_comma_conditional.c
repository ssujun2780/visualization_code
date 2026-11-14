#include <stdio.h>
int calls=0;
int next(int x){ calls++; return x+1; }
int main(void){
 int x=2,y=9;
 int a=(x+=3,x*2); // @write:a
 int b=x<y ? next(x) : next(y); // @write:b
 int c=(x>y && next(40)) || (y>x && next(0)); // @write:c
 int d=(x==5 ? (y+=2,y) : (x+=4,x))+a; // @write:d
 printf("%d %d %d %d %d %d %d\n",x,y,a,b,c,d,calls);
 return 0;
}
