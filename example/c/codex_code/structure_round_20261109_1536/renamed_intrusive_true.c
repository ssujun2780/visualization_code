#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct Xcdbe80b720 {struct Xcdbe80b720*X7b904b337f;struct Xcdbe80b720*prev;} Xcdbe80b720;
typedef struct {int key;Xcdbe80b720 X79c809f044;int X081f1d2671;} X368aa38d25;
int main(void){
 Xcdbe80b720 Xc3c8f2d20c;Xc3c8f2d20c.X7b904b337f=&Xc3c8f2d20c;Xc3c8f2d20c.prev=&Xc3c8f2d20c;
 X368aa38d25 X16b10e9a19[4]={{.key=11},{.key=7},{.key=3},{.key=5}};
 for(int i=3;i>=0;i--){
  X16b10e9a19[i].X79c809f044.X7b904b337f=Xc3c8f2d20c.X7b904b337f;
  X16b10e9a19[i].X79c809f044.prev=&Xc3c8f2d20c;Xc3c8f2d20c.X7b904b337f->prev=&X16b10e9a19[i].X79c809f044;
  Xc3c8f2d20c.X7b904b337f=&X16b10e9a19[i].X79c809f044;
 }
 int X3429eb5f53=0,X8e1e9d4df8=0;
 for(Xcdbe80b720*p=Xc3c8f2d20c.X7b904b337f;p!=&Xc3c8f2d20c;p=p->X7b904b337f){X368aa38d25*X4ed786127f=(X368aa38d25*)((char*)p - offsetof(X368aa38d25,X79c809f044));X3429eb5f53+=X4ed786127f->key;X8e1e9d4df8++;}
 printf("%d %d\n",X3429eb5f53,X8e1e9d4df8);
 return 0;
}
