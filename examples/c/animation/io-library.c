#include <stdio.h>
#include <string.h>

int main(void) {
    int repeat;
    char word[12];
    if (scanf("%d %11s", &repeat, word) != 2) return 0;

    char copy[24];
    strcpy(copy, word);
    strcat(copy, "!");
    char raw[24];
    memcpy(raw, copy, strlen(copy) + 1);

    char overlap[12] = "abcde";
    memmove(overlap + 1, overlap, 4);
    overlap[5] = '\0';
    char marks[4];
    memset(marks, '!', 3);
    marks[3] = '\0';

    char message[40];
    int length = snprintf(message, sizeof message, "%s:%d", raw, repeat);
    puts(message);
    fputs(marks, stdout);
    putchar('\n');
    fprintf(stderr, "len=%d\n", length);

    int newline = getchar();
    char line[16];
    if (fgets(line, sizeof line, stdin) != NULL) fputs(line, stdout);
    return newline == EOF ? 1 : 0;
}
