import assert from 'node:assert/strict';
import {test} from 'node:test';
import {typed,operand,parseCall,splitTop} from '../scripts/model/llvm.mjs';
import {instrumentLLVM} from '../scripts/model/instrument.mjs';

test('LLVM type boundaries preserve composed pointers and function signatures',()=>{
  for(const type of ['i32','i32**','void (i8*)*','i8* (i32)*','i32* (i32)*',
    '%struct.Item* (%struct.Item*, %struct.Item*, i32)**',
    'i32* (i32*)* (i32, void (i8*)*)*',
    '[3 x i8* (i32)*]','{ i32, i8* (i32)* }*','<{ i8, [2 x i32 (i32)*] }>*',
    '%"name (with) spaces"* (%"name (with) spaces"*)*',
    'i8 addrspace(2)* (i32)*','i32 (i8*, ...)*']){
    assert.deepEqual(typed(type+' %value'),{type,value:'%value'},type);
    assert.deepEqual(typed(type),{type,value:''},type);
  }
  assert.deepEqual(operand('i8* (i32)* nonnull %callback'),{type:'i8* (i32)*',value:'%callback'});
  assert.deepEqual(typed('i8* bitcast (i32* @data to i8*)'),{type:'i8*',value:'bitcast (i32* @data to i8*)'});
  assert.deepEqual(splitTop('i32* (i32*, i32)* %f, i8* %s'),['i32* (i32*, i32)* %f','i8* %s']);
});

test('call return extraction removes only an outer function signature',()=>{
  for(const [text,returnType,callee]of [
    ['call i8* %f(i32 1)','i8*','%f'],
    ['call i32 (i8*, ...) @format(i8* %s, i32 2)','i32','@format'],
    ['call i8* (i32)* @factory()','i8* (i32)*','@factory'],
    ['call i8* (i32)* (i32, ...) @factory(i32 1, i32 2)','i8* (i32)*','@factory'],
    ['call i8* (i32)* (i32)* @nested()','i8* (i32)* (i32)*','@nested']]){
    const call=parseCall(text);assert.equal(call.returnType,returnType);assert.equal(call.callee,callee);
  }
});

test('unbalanced types and unconsumed allocation type tails are rejected',()=>{
  for(const text of ['i8* (i32','[2 x i32 (i8*)*','{ i32, [2 x i8 }*','i32 (i8])'])assert.throws(()=>typed(text),/괄호/);
  assert.throws(()=>instrumentLLVM('define i32 @main() {\nentry:\n  %x = alloca i32 unexpected\n  ret i32 0\n}\n','int main(void){return 0;}'),/할당 자료형을 끝까지/);
});
