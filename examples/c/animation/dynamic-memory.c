#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *values = malloc(3 * sizeof *values);
    int *zeros = calloc(3, sizeof *zeros);
    if (values == NULL || zeros == NULL) {
        free(values);
        free(zeros);
        return 1;
    }
    values[0] = 7;
    values[1] = 11;

    int *resized = realloc(values, 5 * sizeof *values);
    if (resized == NULL) {
        free(values);
        free(zeros);
        return 1;
    }
    values = resized;
    values[3] = 23;
    values[4] = 31;
    zeros[1] = values[1];

    resized = realloc(values, 2 * sizeof *values);
    if (resized == NULL) {
        free(values);
        free(zeros);
        return 1;
    }
    values = resized;
    printf("%d %d %d\n", values[0], values[1], zeros[1]);
    free(values);
    values = NULL;
    resized = NULL;
    free(zeros);
    zeros = NULL;
    return 0;
}
