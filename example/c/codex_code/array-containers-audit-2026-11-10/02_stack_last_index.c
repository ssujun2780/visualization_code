#include <stdio.h>

long a[7];int z=-1;
void put(long v){z=z+1;a[z]=v;}
long take(void){long r=a[z];z=z-1;return r;}
int main(void){put(10);put(20);put(20);long x=take();put(30);long y=take();printf("S0 %ld %ld %d\n",x,y,z);return 0;}
