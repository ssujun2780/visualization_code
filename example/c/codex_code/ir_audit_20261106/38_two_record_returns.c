#include <stdio.h>
typedef struct {int x,y;} Item;
Item make(int n){
 Item first={n,n+1};Item second={9,10};
 if(n>0)return first;
 return second;
}
int main(void){Item a=make(4),b=make(0);printf("%d %d %d %d\n",a.x,a.y,b.x,b.y);return 0;}
