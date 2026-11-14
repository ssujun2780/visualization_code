#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct Zj{struct Zj*Xb,*Ab;int Wq;}Zj;int Vv(Zj*p){int s=p->Wq;for(Zj*q=p->Xb;q;q=q->Ab)s+=Vv(q);return s;}int main(void){Zj Uk[3]={0};int v[3]={-1,12,-6};for(int i=0;i<3;i++){Uk[i].Wq=v[i];if(2*i+1<3)Uk[i].Xb=&Uk[2*i+1];if(i%2==1&&i+1<3)Uk[i].Ab=&Uk[i+1];}Zj*Hh=Uk;printf("%d\n",Vv(Hh));return 0;}
