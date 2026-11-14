import fs from 'node:fs/promises';import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8')),added=[];
function add(id,title,body,stdout,process,checks={}){if(manifest.cases.some(c=>c.id===id))throw Error('Already exists');const source='#include <stdio.h>\n'+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin:'',process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('59_multiline_vla_return','Separate-line VLA return with two source exit paths',String.raw`
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
}`,'6 11\n',['First call returns from line 13; second returns from line 15.','Shared LLVM cleanup must not replace executed return source with closing brace.'],{calls:{sum:2}});
add('60_multiline_void_return','Early void return on a distinct source line',String.raw`
void copy_if(int *out, int x) {
    if (x < 0) {
        return;
    }
    int temporary = x;
    *out = temporary;
}
int main(void) {
    int value = 1;
    copy_if(&value, -1);
    copy_if(&value, 2);
    printf("%d\n", value);
    return 0;
}`,'2\n',['First copy_if exits on explicit return line; second reaches implicit function end.','No write to value on early return.'],{calls:{copy_if:2},writes:[{object:'value',values:['1','2']}]} );
add('61_multiline_record_return','Aggregate return on a distinct source line',String.raw`
typedef struct { int a, b; } Pair;
Pair make(int x) {
    Pair p = {x, x + 1};
    Pair copy = p;
    return copy;
}
int main(void) {
    Pair p = make(2);
    printf("%d %d\n", p.a, p.b);
    return 0;
}`,'2 3\n',['Value snapshot and field writes remain correct.','Return event should identify return copy, not function closing brace.'],{calls:{make:1}});
add('62_multiline_macro_local','Macro-local scope with renamed temporary and split calls',String.raw`
#define EXCHANGE(left,right) do { int saved = (left); (left) = (right); (right) = saved; } while (0)
int main(void) {
    int first = 2;
    int second = 7;
    EXCHANGE(first, second);
    EXCHANGE(first, second);
    printf("%d %d\n", first, second);
    return 0;
}`,'2 7\n',['Two distinct saved lifetimes; both macros execute despite net identity.','Compiler macro expansion should identify declaration independently of spelling.'],{objectCounts:{saved:2}});
add('63_multiline_scalar_control','Ordinary scalar return as a location control',String.raw`
int make(int x) {
    int copy = x;
    return copy;
}
int main(void) {
    int value = make(2);
    printf("%d\n", value);
    return 0;
}`,'2\n',['Without VLA cleanup or aggregate return storage, scalar return should map directly.'],{calls:{make:1}});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(`Saved ${added.length} predictions before execution.`);
