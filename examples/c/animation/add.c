#include <stdio.h>

int add(int x, int y) {
    return x + y;
}

int main(void) {
    int a = 10;
    int b = 20;
    int c = add(a, b);
    return 0;
}
