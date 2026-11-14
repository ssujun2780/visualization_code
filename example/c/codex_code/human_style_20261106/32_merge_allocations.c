#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void sort(int*a,int n){if(n<2)return;int m=n/2;sort(a,m);sort(a+m,n-m);int*t=malloc((size_t)n*sizeof *t);if(!t)exit(1);int i=0,j=m,k=0;while(i<m&&j<n){if(a[i]<a[j])t[k++]=a[i++];else t[k++]=a[j++];}while(i<m)t[k++]=a[i++];while(j<n)t[k++]=a[j++];for(i=0;i<n;i++)a[i]=t[i];free(t);}
int main(void){int a[6]={6,2,5,1,4,3};sort(a,6);for(int i=0;i<6;i++)printf("%d ",a[i]);puts("");return 0;}
