#include <stdio.h>
int bins[3];int main(void){for(int k=1;k<=6;k++)bins[k%3]+=k;printf("A %d %d %d\n",bins[0],bins[1],bins[2]);return 0;}
