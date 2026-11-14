#include <stdio.h>
typedef struct {int k,t;} E;E a[8];int n;
int before(E x,E y){if(x.k!=y.k)return x.k<y.k;return x.t>y.t;}
void put(E x){int i=n++;a[i]=x;while(i){int p=(i-1)/2;if(!before(a[i],a[p]))break;E t=a[i];a[i]=a[p];a[p]=t;i=p;}}
E take(void){E out=a[0];a[0]=a[--n];int i=0;while(i*2+1<n){int c=i*2+1;if(c+1<n&&before(a[c+1],a[c]))c++;if(!before(a[c],a[i]))break;E t=a[i];a[i]=a[c];a[c]=t;i=c;}return out;}
int main(void){put((E){4,1});put((E){2,5});put((E){3,7});put((E){2,9});printf("%d:%d ",a[0].k,a[0].t);take();while(n){E e=take();printf("%d:%d ",e.k,e.t);}return 0;}