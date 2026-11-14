#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[16],n;
void put(int x){int i=n++;while(i&&a[(i-1)/2]>x){a[i]=a[(i-1)/2];i=(i-1)/2;}a[i]=x;}
int take(void){int answer=a[0],x=a[--n],i=0;while(i*2+1<n){int j=i*2+1;if(j+1<n&&a[j+1]<a[j])j++;if(a[j]>=x)break;a[i]=a[j];i=j;}if(n)a[i]=x;return answer;}
int main(void){put(9);put(3);put(7);put(1);put(4);int order=0;while(n)order=order*10+take();printf("%d\n",order);return 0;}
