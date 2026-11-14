#include <stdio.h>
int main(void){int n=3;int a[n];for(int i=0;i<n;i++)a[i]=i+1;printf("%d %d\n",a[2],(int)sizeof a);return 0;}
