#include <stdio.h>
int a[4]={1,2,3,4},v[8],w[4];int main(void){int sum=0;for(int i=0;i<4;i++){sum+=a[i];w[i]=sum;v[2*i]=a[i];}printf("%d ",sum);return 0;}