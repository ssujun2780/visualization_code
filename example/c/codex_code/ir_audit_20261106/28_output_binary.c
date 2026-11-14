#include <stdio.h>
int main(void){unsigned char data[4]={'A',0,'B','\n'};fwrite(data,1,4,stdout);fputs("end",stdout);fputc('\n',stdout);return 0;}
