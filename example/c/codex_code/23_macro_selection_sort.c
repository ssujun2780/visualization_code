#include <stdio.h>
#define BEFORE(a,b) ((a)<(b))
#define PICK(a,b) (BEFORE((a),(b))?(a):(b))
#define SWAP(a,b) do {int temporary=(a);(a)=(b);(b)=temporary;} while(0)
int main(void){int n,a[24];if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++)if(scanf("%d",&a[i])!=1)return 1;
 for(int i=0;i<n;i++){int k=i;for(int j=i+1;j<n;j++)if(BEFORE(a[j],a[k]))k=j;if(k!=i)SWAP(a[i],a[k]);}
 for(int i=0;i<n;i++){printf("%d%c",a[i],i+1==n?'\n':' ');}printf("%d\n",PICK(a[0],a[n-1]));return 0;}
