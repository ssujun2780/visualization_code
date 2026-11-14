#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){setvbuf(stdout,NULL,_IOFBF,4096);for(int i=1;i<=3;i++){printf("[%d]",i);fputs(".",stdout);}putchar('\n');fflush(stdout);return 0;}
