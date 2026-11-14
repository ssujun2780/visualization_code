int main(void) {
    int value = 2;
    int score = 0;
    if (value < 0) {
        score = -1;
    } else if (value == 0) {
        score = 0;
    } else {
        score = 1;
    }
    int chosen = value > 1 ? 10 : 20;
    switch (value) {
        case 0: score = 100; break;
        case 2: score = 200; break;
        default: score = 300; break;
    }
    int i = 0;
    while (i < 2) {
        score += i;
        i++;
    }
    do {
        score--;
    } while (score > 201);
    for (int j = 0; j < 2; j++) {
        if (j == 0) continue;
        score += j;
    }
    return 0;
}
