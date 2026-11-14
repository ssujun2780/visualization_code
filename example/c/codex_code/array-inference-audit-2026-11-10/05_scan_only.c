#include <stdio.h>
int main(void) {
    int a[8] = {10, 20, 30, 40, 50, 60, 70, 80};
    int n = 3, sum = 0;
    for (int i = 0; i < n; ++i) sum += a[i];
    printf("%d\n", sum);
    return 0;
}
