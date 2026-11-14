#include <stdio.h>

int sum(int n) {
    int a[n];
    int total = 0;
    for (int i = 0; i < n; i++) {
        a[i] = i + 1;
    }
    for (int i = 0; i < n; i++) {
        total += a[i];
    }
    if (n == 3) {
        return total;
    }
    return total + 1;
}
int main(void) {
    int a = sum(3);
    int b = sum(4);
    printf("%d %d\n", a, b);
    return 0;
}
