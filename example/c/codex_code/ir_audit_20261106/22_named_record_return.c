#include <stdio.h>
typedef struct {int x,y;} Item;
Item make(int n){
 Item local={n,n+1};
 local.y+=2;
 return local;
}
int main(void){Item result=make(4);printf("%d %d\n",result.x,result.y);return 0;}
