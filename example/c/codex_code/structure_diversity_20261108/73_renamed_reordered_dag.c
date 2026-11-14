#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct Qx{struct Qx*Mz;int Wu;struct Qx*Ax;}Qx;
int Fp(Qx*Rt){return Rt?Rt->Wu+Fp(Rt->Ax)+Fp(Rt->Mz):0;}
int main(void){Qx Jk[4]={{.Wu=1},{.Wu=2},{.Wu=3},{.Wu=4}};Jk[0].Ax=&Jk[1];Jk[0].Mz=&Jk[2];Jk[1].Ax=&Jk[3];Jk[2].Ax=&Jk[3];Qx*Zz=Jk;printf("%d\n",Fp(Zz));return 0;}
