#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int a[16]={0};a[0*4+1]=1;a[0*4+2]=1;a[1*4+3]=1;a[2*4+3]=1;int seen[4]={1,0,0,0};
 for(int repeat=0;repeat<4;repeat++)for(int i=0;i<4;i++)for(int j=0;j<4;j++)if(seen[i]&&a[(i<<2)|j])seen[j]=1;
 int result=0;for(int i=0;i<4;i++)result+=seen[i];printf("%d\n",result);return 0;}

