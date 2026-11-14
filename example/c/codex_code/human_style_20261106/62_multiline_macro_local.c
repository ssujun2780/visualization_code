#include <stdio.h>

#define EXCHANGE(left,right) do { int saved = (left); (left) = (right); (right) = saved; } while (0)
int main(void) {
    int first = 2;
    int second = 7;
    EXCHANGE(first, second);
    EXCHANGE(first, second);
    printf("%d %d\n", first, second);
    return 0;
}
