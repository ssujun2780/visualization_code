#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int power10(int n){int p=1;for(int i=0;i<n;i++)p*=10;return p;}
int main(void){char s[6]="12034";int n=(int)strlen(s),answer=0;for(int i=0;i<n;i++){int digit=s[i]-'0';answer+=digit*power10(n-1-i);}printf("%d\n",answer);return 0;}
