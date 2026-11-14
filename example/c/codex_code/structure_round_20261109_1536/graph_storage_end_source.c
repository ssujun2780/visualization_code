#include <stdio.h>
#include <stdlib.h>
int main(void){
 int*from=malloc(3*sizeof(int));int*to=malloc(3*sizeof(int));int*weight=malloc(3*sizeof(int));
 if(!from||!to||!weight){free(from);free(to);free(weight);return 1;}
 for(int i=0;i<3;i++){from[i]=i;to[i]=i+1;weight[i]=1;}
 int d[4]={0,100,100,100};
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[to[k]]>d[from[k]]+weight[k])d[to[k]]=d[from[k]]+weight[k];
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 free(from);from=NULL;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 free(to);free(weight);
 return 0;
}