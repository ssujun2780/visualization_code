#include <stdio.h>
int sum=0;
int visit(int n){
 static int calls=0;calls++;
 int local=n;
 if(n>0)local+=visit(n-1);
 sum+=local;
 return local;
}
int main(void){int a=visit(3);int b=visit(1);printf("%d %d %d\n",a,b,sum);return 0;}
