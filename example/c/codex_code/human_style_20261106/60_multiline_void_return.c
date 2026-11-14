#include <stdio.h>

void copy_if(int *out, int x) {
    if (x < 0) {
        return;
    }
    int temporary = x;
    *out = temporary;
}
int main(void) {
    int value = 1;
    copy_if(&value, -1);
    copy_if(&value, 2);
    printf("%d\n", value);
    return 0;
}
