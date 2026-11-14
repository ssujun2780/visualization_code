#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
 int *p=malloc(3*sizeof *p);if(!p)return 1;
 p[0]=3;p[1]=6;p[2]=9;
 int *q=realloc(p,6*sizeof *q);if(!q){free(p);return 1;}p=q;
 for(int i=3;i<6;i++)p[i]=p[i-3]+10;
 int copy[6];memcpy(copy,p,6*sizeof *p);free(p);p=NULL;
 int total=0;for(int i=0;i<6;i++)total+=copy[i];
 printf("%d %d\n",total,p==NULL);return 0;
}
