static int touch(int *calls) {
    *calls += 1;
    return *calls;
}

int main(void) {
    int a = 3;
    int b = 5;
    int calls = 0;
    int result = 0;
    result = a < b && b < 10;
    result = a > b && touch(&calls);
    result = a < b || touch(&calls);
    result = a > b || touch(&calls);
    result = !(a && b);
    result = !calls;
    result = ((a + 1 > b * 2) && (b - 1 != 0)) || calls;
    result = 0 && ++calls;
    result = 1 || ++calls;
    return 0;
}
