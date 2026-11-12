#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int k,t;}E;E*a;
int before(const E*x,const E*y){if(x->k!=y->k)return x->k<y->k;return x->t>y->t;}
int main(void){a=malloc(3*sizeof *a);if(!a)return 1;a[0]=(E){1,9};a[1]=(E){2,7};a[2]=(E){1,2};int x=before(a,a+1),y=before(a,a+2);printf("%d %d\n",x,y);free(a);a=0;puts("end");return 0;}