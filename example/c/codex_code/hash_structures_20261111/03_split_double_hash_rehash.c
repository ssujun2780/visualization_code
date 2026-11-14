#include <stdio.h>
#include <stdlib.h>
int *keys,*values,*flags,capacity,count;
void allocate(int n){capacity=n;count=0;keys=calloc(n,sizeof(int));values=calloc(n,sizeof(int));flags=calloc(n,sizeof(int));if(!keys||!values||!flags)exit(1);}
void put(int k,int v){int p=k%capacity,step=1+k%(capacity-1);while(flags[p]&&keys[p]!=k)p=(p+step)%capacity;if(!flags[p]){flags[p]=1;count++;}keys[p]=k;values[p]=v;}
int get(int k){int p=k%capacity,step=1+k%(capacity-1);for(int n=0;n<capacity;n++,p=(p+step)%capacity){if(!flags[p])return -1;if(keys[p]==k)return values[p];}return -1;}
void grow(void){int *a=keys,*b=values,*c=flags,n=capacity;allocate(11);for(int i=0;i<n;i++)if(c[i])put(a[i],b[i]);free(a);free(b);free(c);}
int main(void){allocate(5);put(1,10);put(6,60);put(11,110);printf("A %d %d %d %d %d\n",count,capacity,get(1),get(6),get(11));grow();put(16,160);printf("B %d %d %d %d %d %d\n",count,capacity,get(1),get(6),get(11),get(16));free(keys);free(values);free(flags);return 0;}
