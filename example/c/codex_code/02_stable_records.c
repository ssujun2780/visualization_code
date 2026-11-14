#include <stdio.h>
#include <stdlib.h>
typedef struct {int key;int origin;} Entry;
static void join(Entry*a,Entry*b,int l,int m,int r){
 int i=l,j=m,k=l;
 while(i<m&&j<r)b[k++]=a[i].key<=a[j].key?a[i++]:a[j++];
 while(i<m){b[k++]=a[i++];}
 while(j<r){b[k++]=a[j++];}
 for(i=l;i<r;i++)a[i]=b[i];
}
static void divide(Entry*a,Entry*b,int l,int r){if(r-l<2)return;int m=l+(r-l)/2;divide(a,b,l,m);divide(a,b,m,r);join(a,b,l,m,r);}
int main(void){int n;if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 Entry*a=malloc((size_t)n*sizeof*a),*b=malloc((size_t)n*sizeof*b);if(!a||!b){free(a);free(b);return 1;}
 for(int i=0;i<n;i++){if(scanf("%d",&a[i].key)!=1){free(a);free(b);return 1;}a[i].origin=i;}
 divide(a,b,0,n);
 for(int i=0;i<n;i++)printf("%d:%d%c",a[i].key,a[i].origin,i+1==n?'\n':' ');
 free(b);free(a);return 0;}
