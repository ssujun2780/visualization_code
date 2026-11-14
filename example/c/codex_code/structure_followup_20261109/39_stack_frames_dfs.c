#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int v,edge;}Frame;
int main(void){int off[5]={0,2,3,4,4},to[4]={1,2,3,3},seen[4]={0};Frame stack[8];int size=1,order=0;stack[0]=(Frame){0,0};seen[0]=1;
while(size){Frame*f=&stack[size-1];if(f->edge==off[f->v+1]-off[f->v]){order=order*10+f->v;size--;continue;}int v=to[off[f->v]+f->edge++];if(!seen[v]){seen[v]=1;stack[size++]=(Frame){v,0};}}
printf("%d\n",order);return 0;}
