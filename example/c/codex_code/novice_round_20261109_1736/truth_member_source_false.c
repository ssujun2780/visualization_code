#include <stdio.h>
typedef struct R { int flag, value; } R;
int main(void) {
    R a[2] = {{0,3},{1,7}};
    R *p = &a[1];
    int sum = 0;
    if (p->flag) {
        sum += p->value;
    }
    printf("%d\n",sum);
    return 0;
}
