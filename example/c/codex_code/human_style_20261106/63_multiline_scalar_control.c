#include <stdio.h>

int make(int x) {
    int copy = x;
    return copy;
}
int main(void) {
    int value = make(2);
    printf("%d\n", value);
    return 0;
}
