#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int gcd(int a,int b){while(a!=b){if(a>b)a-=b;else b-=a;}return a;}
int main(void){int a[3]={18,35,48},b[3]={12,15,18},sum=0;for(int i=0;i<3;i++){int first=gcd(a[i],b[i]);int second=gcd(a[i],b[i]);sum+=first+second;}printf("%d\n",sum);return 0;}
