#include <stdio.h>
int links[2][2]={{1,0},{0,1}};int main(void){const char*s="aba";int p=0;while(*s){p=links[p][*s-'a'];s++;}printf("Q %d\n",p);return 0;}
