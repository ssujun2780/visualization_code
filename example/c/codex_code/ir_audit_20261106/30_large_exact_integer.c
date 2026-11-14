#include <stdio.h>
int main(void){
 unsigned long long a=9007199254740993ULL;
 unsigned long long b=a+2ULL;
 long long n=-23;
 long long q=n/7,r=n%7;
 unsigned long long wrap=(unsigned long long)(-1LL);
 printf("%llu %llu %lld %lld %llu\n",a,b,q,r,wrap-b);
 return 0;
}
