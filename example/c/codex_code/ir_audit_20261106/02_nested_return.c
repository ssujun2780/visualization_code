#include <stdio.h>
typedef struct {int a[2];int *p;} Pair;
Pair make(int *p,int n){ Pair r={{n,n+1},p};return r; }
Pair alter(Pair r){r.a[1]+=*r.p;*r.p+=2;return r;}
int main(void){
 int base=5;
 Pair r=alter(make(&base,3));
 int sum=r.a[0]+r.a[1]+*r.p; // @write:sum
 printf("%d %d %d %d\n",r.a[0],r.a[1],base,sum);
 return 0;
}
