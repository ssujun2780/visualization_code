#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){double a[3]={1.5,2.25,3.75},total=0;for(int i=0;i<3;i++){float copy=(float)a[i];double again=(double)copy;int whole=(int)again;double remainder=again-whole;total+=whole+remainder;}printf("%.2f\n",total);return 0;}
