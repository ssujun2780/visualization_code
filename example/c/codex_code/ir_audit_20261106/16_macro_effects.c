#include <stdio.h>
int calls=0;
int get(int n){calls++;return n;}
#define PICK(a,b) ((a)>(b)?(a):(b))
#define CHANGE(x,y) do {int temporary=(x);(x)=(y);(y)=temporary;}while(0)
int main(void){
 int a=3,b=8;
 int chosen=PICK(get(a),get(b));
 CHANGE(a,b);
 printf("%d %d %d %d\n",chosen,a,b,calls);
 return 0;
}
