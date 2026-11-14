#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SWAP(a,b) do{int temporary=(a);(a)=(b);(b)=temporary;}while(0)
#define STEP(x) ((x)*2+1)
int main(void){int a[3]={1,2,3};for(int i=0;i<4;i++){SWAP(a[0],a[2]);SWAP(a[0],a[2]);}int sum=0;for(int i=0;i<3;i++)sum+=STEP(a[i]);printf("%d %d %d %d\n",a[0],a[1],a[2],sum);return 0;}
