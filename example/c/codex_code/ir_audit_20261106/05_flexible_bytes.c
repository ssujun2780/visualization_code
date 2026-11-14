#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {int n;unsigned char data[];} Packet;
int main(void){
 Packet *p=malloc(sizeof *p+4*sizeof p->data[0]);if(!p)return 1;
 p->n=4;
 for(int i=0;i<p->n;i++)p->data[i]=(unsigned char)(10+i);
 unsigned char copy[4];memcpy(copy,p->data,4);
 int total=0;for(int i=0;i<4;i++)total+=copy[i];
 printf("%d %u %u %d\n",p->n,(unsigned)copy[0],(unsigned)copy[3],total);
 free(p);return 0;
}
