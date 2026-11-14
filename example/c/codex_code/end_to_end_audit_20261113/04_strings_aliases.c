#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct { int value; char *text; } Record;
int main(void) {
    char a[32]="ABCDE", b[32]={0};
    char *p=a+1;
    memmove(p+1,p,4);
    a[6]='\0';
    memcpy(b,a,7);
    Record first={7,a}, second=first;
    second.text[0]='Z';
    snprintf(b+7,sizeof(b)-7,"%d:%s",second.value,b);
    puts(a);
    fwrite(b,1,6,stdout);
    putchar('\n');
    puts(b+7);
    return 0;
}
