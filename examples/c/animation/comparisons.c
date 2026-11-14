#include <math.h>

int main(void) {
    int a = 3;
    int b = 5;
    int result = 0;
    result = a < b;
    result = a <= b;
    result = a > b;
    result = a >= b;
    result = a == b;
    result = a != b;

    int negative = -3;
    unsigned int positive = 2U;
    result = negative < positive;
    if (negative) result = 1;
    if (a - a) result = 2;

    double real = -0.0;
    if (real) result = 3;
    real = 0.25;
    if (real) result = 4;
    real = NAN;
    result = real == real;
    result = real != real;
    if (real) result = 5;

    _Bool flag = 1;
    if (flag) result = 6;
    flag = 0;
    if (flag) result = 7;
    int *pointer = &a;
    if (pointer) result = 8;
    pointer = 0;
    if (pointer) result = 9;
    result = pointer == 0;
    return 0;
}
