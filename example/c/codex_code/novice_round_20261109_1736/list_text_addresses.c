#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{char name[8],next[8];int v;}R;
int main(void){R a[4]={{"red","blue",2},{"green","",7},{"blue","green",5},{"spare","red",99}};char at[8]="red";int sum=0,count=0;while(at[0]){int k=-1;for(int i=0;i<4;i++)if(strcmp(a[i].name,at)==0)k=i;if(k<0)break;sum+=a[k].v;count++;strcpy(at,a[k].next);}printf("%d %d\n",count,sum);return 0;}
