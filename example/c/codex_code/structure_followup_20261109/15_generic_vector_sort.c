#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct{void*data;size_t size,width;}Vec;
void push(Vec*v,const void*x){void*p=realloc(v->data,(v->size+1)*v->width);if(!p)exit(1);v->data=p;memcpy((char*)v->data+v->size*v->width,x,v->width);v->size++;}
int compare(const void*a,const void*b){int x=*(const int*)a,y=*(const int*)b;return (x>y)-(x<y);}
int main(void){Vec v={0,0,sizeof(int)};int input[5]={7,2,9,2,1};for(int i=0;i<5;i++)push(&v,&input[i]);qsort(v.data,v.size,v.width,compare);int*s=v.data;printf("%d %d %d %d %d\n",s[0],s[1],s[2],s[3],s[4]);free(v.data);return 0;}
